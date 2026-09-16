import type { ClimbTarget } from "../ambient/climb-geometry";
import { type Climber, createClimber } from "../ambient/climber";
import { createFaller, type DropOptions, type Faller } from "../ambient/faller";
import { createJumper } from "../ambient/jumper";
import { createPercher, type Percher, type PercherWindow } from "../ambient/percher";
import type { Sitter } from "../ambient/sitter";
import { createWalker, type Walker } from "../ambient/walker";
import type {
  ClimbConfig,
  DescendConfig,
  FallConfig,
  GestureCuesConfig,
  JumpConfig,
  PerchWalkConfig,
  WalkConfig,
} from "../config/load";
import type { MotionKind, WindowRect } from "../contract";
import { isReflexTurn } from "../dispatcher/backend-caller";
import type { Dispatcher } from "../dispatcher/dispatcher";
import type { EventBus } from "../dispatcher/event-bus";
import { type DescentEdge, type PetWindow, toScreenMonitor } from "../io/window/screen-geometry";
import { isTauri } from "../io/window/tauri-env";
import { createTravelFrame, type FrameWindow, type Travel } from "../io/window/travel-frame";
import type { Logger } from "../logger";
import type { Renderer } from "../renderer";

/**
 * The shared travel frame: parks the real pet window once for a seam crossing (the
 * escape stroll and the monitor-wall climb) and reports a virtual window while one
 * runs. `getWindow` is what the walker, faller and climber read the pet window through;
 * `travel` is what the walker and climber drive a crossing with.
 *
 * Tauri-only — a travel moves the real OS window, so in a plain browser (Vite dev) this
 * is skipped and `getWindow`/`travel.begin` are never called (their callers gate on
 * `isTauri()` too). `ready` resolves once the real window is wired; callers await it
 * before starting, so `getWindow`/`travel.begin` are never called too early.
 */
interface TravelFrameHandle {
  getWindow(): PetWindow;
  travel: {
    begin(end: { x: number; y: number }, via?: Array<{ x: number; y: number }>): Promise<Travel>;
    current(): PetWindow | null;
  };
  /** Ends whatever travel is active or being parked right now, deterministically —
   *  resolves once fully unparked, or immediately when nothing is in flight. */
  abort(): Promise<void>;
  /** Resolves once the real window is wired — callers await it before starting. */
  ready: Promise<void>;
  dispose(): void;
}

export function wireTravelFrame(deps: {
  renderer: Pick<Renderer, "setViewWindow">;
  setKeepOnScreenPaused: (paused: boolean) => void;
  log: Logger;
}): TravelFrameHandle {
  let disposed = false;
  let realWindow: FrameWindow | null = null;
  let travel: ReturnType<typeof createTravelFrame> | null = null;
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const handle = {
    getWindow: (): PetWindow => {
      if (!travel || !realWindow) throw new Error("wireTravelFrame: not ready");
      return travel.current() ?? realWindow;
    },
    travel: {
      begin: (
        end: { x: number; y: number },
        via?: Array<{ x: number; y: number }>,
      ): Promise<Travel> => {
        if (!travel) throw new Error("wireTravelFrame: not ready");
        return travel.begin(end, via);
      },
      current: (): PetWindow | null => travel?.current() ?? null,
    },
    abort: (): Promise<void> => travel?.abort() ?? Promise.resolve(),
    ready,
    dispose: () => {
      disposed = true;
    },
  };
  if (!isTauri()) {
    resolveReady();
    return handle;
  }
  void (async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const { availableMonitors, getCurrentWindow } = await import("@tauri-apps/api/window");
    const { LogicalPosition } = await import("@tauri-apps/api/dpi");
    if (disposed) {
      resolveReady();
      return;
    }
    realWindow = {
      outerPosition: () => getCurrentWindow().outerPosition(),
      outerSize: () => getCurrentWindow().outerSize(),
      scaleFactor: () => getCurrentWindow().scaleFactor(),
      setPositionLogical: (x, y) => getCurrentWindow().setPosition(new LogicalPosition(x, y)),
      setFrameLogical: (x, y, width, height) =>
        invoke("set_frame_logical", { x, y, width, height }) as Promise<void>,
    };
    travel = createTravelFrame({
      frame: realWindow,
      renderer: deps.renderer,
      listMonitors: async () => (await availableMonitors()).map(toScreenMonitor),
      setKeepOnScreenPaused: deps.setKeepOnScreenPaused,
    });
    resolveReady();
  })().catch((err) => {
    deps.log.warn("travel_frame_wiring_failed", { degrade: true, error: String(err) });
    resolveReady();
  });
  return handle;
}

/**
 * Ambient floor walking. Tauri-only — a stroll moves the OS window, so in a plain browser
 * (Vite dev) this is skipped and bootstrap continues. The returned handle cancels a running
 * stroll for the owners that outrank ambient (user drag, agent command) and owns teardown.
 */
export function wireWalker(deps: {
  bus: EventBus;
  renderer: Renderer;
  travelFrame: TravelFrameHandle;
  getWalkConfig: () => WalkConfig;
  getDescendConfig: () => DescendConfig;
  /** Registry kind of a motion id, for the "nothing else holds the body" gate. */
  getMotionKind: (id: string) => MotionKind | undefined;
  isPeeking: () => boolean;
  isDragging: () => boolean;
  /** Keep the hit-test cursor mapping accurate while the window translates. */
  setHitTestMoving: (moving: boolean) => void;
  /** An ambient stroll ended — bodyReleased is true only when the walker itself handed the
   * clip back, not when another motion had already taken it. */
  onStrollEnd: (bodyReleased: boolean) => void;
  onDescend: (edge: DescentEdge) => void;
  log: Logger;
}): {
  walkTo(toX: number, onAccepted?: () => void, holdClip?: boolean): Promise<"arrived" | "lost">;
  cancel(): void;
  isStrolling(): boolean;
  dispose(): void;
} {
  const { bus, renderer, log } = deps;
  let walker: Walker | null = null;
  let disposed = false;
  const handle = {
    walkTo: async (
      toX: number,
      onAccepted?: () => void,
      holdClip?: boolean,
    ): Promise<"arrived" | "lost"> => (await walker?.walkTo(toX, onAccepted, holdClip)) ?? "lost",
    cancel: () => walker?.cancel(),
    isStrolling: () => walker?.isStrolling() ?? false,
    dispose: () => {
      disposed = true;
      walker?.stop();
    },
  };
  if (!isTauri()) return handle;
  void (async () => {
    const { availableMonitors } = await import("@tauri-apps/api/window");
    await deps.travelFrame.ready;
    if (disposed) return;
    const push = (event_name: string): void => {
      bus.push({ source: "timer_scheduler", event_name, ts: Date.now(), hint_tier: 1 });
    };
    walker = createWalker({
      renderer,
      getWindow: deps.travelFrame.getWindow,
      travel: deps.travelFrame.travel,
      listMonitors: async () => (await availableMonitors()).map(toScreenMonitor),
      getConfig: deps.getWalkConfig,
      getDescendConfig: deps.getDescendConfig,
      currentMotionKind: () => {
        const current = renderer.getCurrentMotion();
        return current ? (deps.getMotionKind(current.id) ?? null) : null;
      },
      isPeeking: deps.isPeeking,
      isDragging: deps.isDragging,
      onStart: () => {
        deps.setHitTestMoving(true);
        push("avatar.walk_start");
      },
      onEnd: (bodyReleased) => {
        deps.setHitTestMoving(false);
        push("avatar.walk_end");
        deps.onStrollEnd(bodyReleased);
      },
      onDescend: deps.onDescend,
    });
    walker.start();
  })().catch((err) => log.warn("walker_start_failed", { degrade: true, error: String(err) }));
  return handle;
}

/**
 * A reflex turn is an immediate reaction to being touched; it cancels a running stroll
 * the moment it opens. Every other turn leaves the stroll walking.
 */
export function wireStrollReflexCancel(deps: {
  dispatcher: Pick<Dispatcher, "subscribeBusy" | "inFlight">;
  walker: { cancel(): void };
}): () => void {
  return deps.dispatcher.subscribeBusy((busy) => {
    const trigger = deps.dispatcher.inFlight()?.trigger.event_name;
    if (busy && trigger !== undefined && isReflexTurn(trigger)) deps.walker.cancel();
  });
}

/**
 * Ambient walking along a foreign-window perch. Every commitSit-origin perch — a user
 * drag release and an agent placement alike — belongs to this loop: it dwells, strolls
 * the top edge and sits back down, and never descends on its own. A climb-adopted perch
 * stays the climber's.
 */
export function wirePercher(deps: {
  bus: EventBus;
  renderer: Renderer;
  getPerchWalkConfig: () => PerchWalkConfig;
  getJumpConfig: () => JumpConfig;
  getFallConfig: () => FallConfig;
  /** Registry kind of a motion id, for the "nothing else holds the body" gate. */
  getMotionKind: (id: string) => MotionKind | undefined;
  /** A turn is in flight or speech is still playing — ambient movement stays out of the way. */
  isBusy: () => boolean;
  walker: {
    walkTo(toX: number, onAccepted?: () => void): Promise<"arrived" | "lost">;
    cancel(): void;
  };
  sitter: Pick<Sitter, "sitDown" | "standUp" | "cancel">;
  dropSource: {
    armedSit(): { windowNumber: number; origin: "commit" | "adopt"; charHpx: number } | null;
    suspendSit(): {
      windowNumber: number;
      origin: "commit" | "adopt";
      rect: { x: number; y: number };
      charHpx: number;
    } | null;
    resumeSit(edgeLocalYpx: number): void;
    abandonSit(): void;
    adoptSit(
      windowNumber: number,
      rect: { x: number; y: number },
      charHpx: number,
      origin: "commit" | "adopt",
    ): void;
    release(): void;
  };
  /** The perch's host window went away — the character falls from where she stands. */
  onHostLost: () => void;
  /** A jump lost the window it was aimed at — the character falls out of mid-air. */
  onTargetLost: () => void;
  /** An ambient stroll walked her off the host's edge — the fall takes her from there. */
  onStepOff: () => void;
  setHitTestMoving(moving: boolean): void;
  log: Logger;
}): { cancel(): void; landOn(target: WindowRect): void; dispose(): void } {
  const { bus, renderer, log } = deps;
  let percher: Percher | null = null;
  let disposed = false;
  const handle = {
    cancel: () => percher?.cancel(),
    landOn: (target: WindowRect) => percher?.landOn(target),
    dispose: () => {
      disposed = true;
      percher?.stop();
    },
  };
  if (!isTauri()) return handle;
  void (async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const { availableMonitors, getCurrentWindow } = await import("@tauri-apps/api/window");
    const { PhysicalPosition } = await import("@tauri-apps/api/dpi");
    if (disposed) return;
    const win = getCurrentWindow();
    const endWalk = (): void => {
      deps.setHitTestMoving(false);
      bus.push({
        source: "timer_scheduler",
        event_name: "avatar.walk_end",
        ts: Date.now(),
        hint_tier: 1,
      });
    };
    const getWindow = (): PercherWindow => ({
      outerPosition: () => win.outerPosition(),
      scaleFactor: () => win.scaleFactor(),
      setPositionPhysical: (x, y) => win.setPosition(new PhysicalPosition(x, y)),
    });
    const listWindows = (): Promise<WindowRect[]> =>
      invoke("list_windows") as Promise<WindowRect[]>;
    const jumper = createJumper({
      renderer,
      getWindow,
      listWindows,
      getConfig: deps.getJumpConfig,
    });
    percher = createPercher({
      renderer,
      getWindow,
      listWindows,
      listMonitors: async () => (await availableMonitors()).map(toScreenMonitor),
      getConfig: deps.getPerchWalkConfig,
      getJumpConfig: deps.getJumpConfig,
      getFallConfig: deps.getFallConfig,
      walker: deps.walker,
      jumper,
      sitter: deps.sitter,
      dropSource: deps.dropSource,
      currentMotion: () => {
        const current = renderer.getCurrentMotion();
        return current ? { id: current.id, kind: deps.getMotionKind(current.id) ?? null } : null;
      },
      isBusy: deps.isBusy,
      onWalkStart: () => {
        deps.setHitTestMoving(true);
        bus.push({
          source: "timer_scheduler",
          event_name: "avatar.walk_start",
          ts: Date.now(),
          hint_tier: 1,
        });
      },
      onWalkEnd: endWalk,
      // A cancelled stroll still owes the end cue: the posture only leaves walking on it.
      onWalkCancel: endWalk,
      onHostLost: deps.onHostLost,
      onTargetLost: deps.onTargetLost,
      onStepOff: deps.onStepOff,
      onTakeoff: () => {
        bus.push({
          source: "timer_scheduler",
          event_name: "avatar.jump",
          ts: Date.now(),
          hint_tier: 1,
        });
      },
      onSit: (target, edgeLocalYpx) => {
        bus.push({
          source: "os_event_watcher",
          event_name: "avatar.window_sit",
          ts: Date.now(),
          hint_tier: 1,
          dnd_override: true,
          payload: {
            edge_local_ypx: edgeLocalYpx,
            app: target.ownerName,
            window_title: target.name,
          },
        });
      },
    });
    percher.start();
  })().catch((error) => log.warn("percher_start_failed", { degrade: true, error: String(error) }));
  return handle;
}

/**
 * Falling. Tauri-only — a fall moves the OS window, so in a plain browser (Vite dev) this is
 * skipped and bootstrap continues. The returned handle triggers a fall from the drag-release
 * miss, cancels a running one for the user, and owns teardown.
 */
export function wireFaller(deps: {
  bus: EventBus;
  renderer: Renderer;
  travelFrame: Pick<TravelFrameHandle, "getWindow" | "ready">;
  /** The user's fall switch. Off leaves a mid-air character where she hangs. */
  isEnabled: () => boolean;
  getFallConfig: () => FallConfig;
  /** Registry kind of a motion id, for the "only the baseline hands the clip back" gate. */
  getMotionKind: (id: string) => MotionKind | undefined;
  /** The walker's grounded tolerance — the same floor line decides "already down". */
  getFloorTolerancePx: () => number;
  getGestureCues: () => GestureCuesConfig;
  /** Keep the hit-test cursor mapping accurate while the window translates. */
  setHitTestMoving: (moving: boolean) => void;
  /** She came down on a foreign window top — the perch loop takes it from there. */
  onWindowLand: (target: WindowRect) => void;
  log: Logger;
}): { drop(opts?: DropOptions): Promise<void>; cancel(): void; dispose(): void } {
  const { bus, renderer, log } = deps;
  let faller: Faller | null = null;
  let disposed = false;
  const handle = {
    drop: async (opts?: DropOptions) => {
      if (deps.isEnabled()) await faller?.drop(opts);
    },
    cancel: () => faller?.cancel(),
    dispose: () => {
      disposed = true;
      faller?.stop();
    },
  };
  if (!isTauri()) return handle;
  void (async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const { availableMonitors } = await import("@tauri-apps/api/window");
    await deps.travelFrame.ready;
    if (disposed) return;
    faller = createFaller({
      renderer,
      getWindow: deps.travelFrame.getWindow,
      currentMotionKind: () => {
        const current = renderer.getCurrentMotion();
        return current ? (deps.getMotionKind(current.id) ?? null) : null;
      },
      listMonitors: async () => (await availableMonitors()).map(toScreenMonitor),
      listWindows: () => invoke("list_windows") as Promise<WindowRect[]>,
      getConfig: deps.getFallConfig,
      getFloorTolerancePx: deps.getFloorTolerancePx,
      onStart: () => deps.setHitTestMoving(true),
      onEnd: () => deps.setHitTestMoving(false),
      onLand: ({ heightPx, surface, fell }) => {
        const target = surface.kind === "window" ? surface.target : null;
        // A snap is a placement rather than a fall: it hands the seat over and says nothing.
        if (fell) {
          bus.push({
            source: "os_event_watcher",
            event_name: "user.fall_land",
            ts: Date.now(),
            hint_tier: 1,
            dnd_override: true,
            payload: {
              height_px: Math.round(heightPx),
              landed_on: surface.kind,
              app: target?.ownerName ?? null,
              window_title: target?.name ?? null,
            },
          });
        }
        if (target) deps.onWindowLand(target);
      },
      onCue: (heightPx) => {
        const cue = deps.getGestureCues().dropped;
        bus.push({
          source: "os_event_watcher",
          event_name: "proactive.dropped",
          ts: Date.now(),
          hint_tier: 2,
          payload: {
            cue_id: "dropped",
            label: cue.label,
            ...(cue.context !== undefined ? { context: cue.context } : {}),
            height_px: Math.round(heightPx),
          },
        });
      },
    });
  })().catch((err) => log.warn("faller_start_failed", { degrade: true, error: String(err) }));
  return handle;
}

/**
 * Ambient window climbing. Tauri-only — a climb moves the OS window and reads the foreign
 * window stack, so in a plain browser (Vite dev) this is skipped and bootstrap continues.
 * The returned handle cancels a running climb for the user and owns teardown.
 */
export function wireClimber(deps: {
  bus: EventBus;
  renderer: Renderer;
  travelFrame: TravelFrameHandle;
  getClimbConfig: () => ClimbConfig;
  getDescendConfig: () => DescendConfig;
  getFallConfig: () => FallConfig;
  /** The stroll's knobs — the approach reuses its floor tolerance and its reach. */
  getWalkConfig: () => WalkConfig;
  /** Registry kind of a motion id, for the "only the baseline hands the clip back" gate. */
  getMotionKind: (id: string) => MotionKind | undefined;
  isPeeking: () => boolean;
  isDragging: () => boolean;
  /** A turn is in flight or speech is still playing — ambient movement stays out of the way. */
  isBusy: () => boolean;
  walker: { walkTo(toX: number): Promise<"arrived" | "lost">; cancel(): void };
  faller: { drop(): Promise<void>; cancel(): void };
  sitter: Pick<Sitter, "sitDown" | "standUp" | "cancel">;
  dropSource: {
    adoptSit(
      windowNumber: number,
      rect: { x: number; y: number },
      charHpx: number,
      origin: "commit" | "adopt",
    ): void;
    armedSit(): { windowNumber: number; origin: "commit" | "adopt"; charHpx: number } | null;
    release(): void;
  };
  /** Keep the hit-test cursor mapping accurate while the window translates. */
  setHitTestMoving: (moving: boolean) => void;
  log: Logger;
}): {
  cancel(): void;
  descend(edge: DescentEdge): Promise<void>;
  setEnabled(enabled: boolean): void;
  dispose(): void;
} {
  const { bus, renderer, log } = deps;
  let climber: Climber | null = null;
  let disposed = false;
  // Latched here because the inner climber is built asynchronously, after the first toggle.
  let enabled = true;
  const handle = {
    cancel: () => climber?.cancel(),
    descend: (edge: DescentEdge): Promise<void> => climber?.descend(edge) ?? Promise.resolve(),
    setEnabled: (v: boolean) => {
      if (disposed) return;
      enabled = v;
      climber?.setEnabled(v);
    },
    dispose: () => {
      disposed = true;
      climber?.stop();
    },
  };
  if (!isTauri()) return handle;
  void (async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const { availableMonitors } = await import("@tauri-apps/api/window");
    await deps.travelFrame.ready;
    if (disposed) return;
    const push = (event_name: string, payload: Record<string, unknown>): void => {
      bus.push({
        source: "os_event_watcher",
        event_name,
        ts: Date.now(),
        hint_tier: 1,
        dnd_override: true,
        payload,
      });
    };
    // The wall the running climb is on — the end envelope names the same window as the start.
    let wall: ClimbTarget | null = null;
    const where = (target: ClimbTarget | null): Record<string, unknown> => ({
      app: target?.app ?? null,
      window_title: target?.title ?? null,
    });
    climber = createClimber({
      renderer,
      getWindow: deps.travelFrame.getWindow,
      travel: deps.travelFrame.travel,
      listMonitors: async () => (await availableMonitors()).map(toScreenMonitor),
      listWindows: () => invoke("list_windows") as Promise<WindowRect[]>,
      getConfig: deps.getClimbConfig,
      getDescendConfig: deps.getDescendConfig,
      getFallConfig: deps.getFallConfig,
      getWalkConfig: deps.getWalkConfig,
      currentMotionKind: () => {
        const current = renderer.getCurrentMotion();
        return current ? (deps.getMotionKind(current.id) ?? null) : null;
      },
      isPeeking: deps.isPeeking,
      isDragging: deps.isDragging,
      isBusy: deps.isBusy,
      walker: deps.walker,
      faller: deps.faller,
      sitter: deps.sitter,
      dropSource: deps.dropSource,
      onStart: (dir, target) => {
        wall = target;
        deps.setHitTestMoving(true);
        push("avatar.climb_start", { direction: dir, ...where(target) });
      },
      onEnd: (dir) => {
        deps.setHitTestMoving(false);
        push("avatar.climb_end", { direction: dir, ...where(wall) });
        wall = null;
      },
      onSit: (target, edgeLocalYpx) => {
        push("avatar.window_sit", { edge_local_ypx: edgeLocalYpx, ...where(target) });
      },
    });
    if (enabled && !disposed) climber.start();
  })().catch((err) => log.warn("climber_start_failed", { degrade: true, error: String(err) }));
  return handle;
}
