/** Composes the travel frame, the five locomotion loops and the window sources into one handle. */
import { wireClimber } from "../../ambient/locomotion/climb/wire-climb";
import { wireFaller } from "../../ambient/locomotion/fall/wire-fall";
import { wirePercher } from "../../ambient/locomotion/perch/wire-perch";
import { createSitter, type Sitter } from "../../ambient/locomotion/sitter";
import { wireTravelFrame } from "../../ambient/locomotion/travel/wire-travel-frame";
import { wireStrollReflexCancel, wireWalker } from "../../ambient/locomotion/walk/wire-walk";
import type { AppConfig } from "../../config/load";
import type { DescendConfig, FallConfig } from "../../config/validators/avatar/types";
import type { WindowRect } from "../../contract";
import type { EventBus } from "../../dispatcher/core/event-bus";
import type { Dispatcher } from "../../dispatcher/dispatcher";
import type { createVrmSelection } from "../../io/assets/vrm-selection";
import type { AvatarExecutor } from "../../io/bridge/inbox/avatar-executor";
import type { DescentEdge, ScreenMonitor } from "../../io/window/geometry/screen-geometry";
import type { FrameWindow, Travel } from "../../io/window/geometry/travel-frame";
import type { HitTestController } from "../../io/window/pet/hit-test";
import type { Logger } from "../../logger";
import type { Renderer } from "../../renderer";
import type { createAgentNotifySettings } from "../../settings/backend/agent-notify-settings";
import type { FlagSettingsStore } from "../../settings/persisted-store";
import { wireWindowSources } from "./wire-window-sources";

/** With the fall off, a perched stroll never steps off the ledge: nothing would catch her. */
export function fallConfigFor(fall: FallConfig, enabled: boolean): FallConfig {
  return enabled ? fall : { ...fall, step_off_probability: 0 };
}

/** With the fall off, a monitor descent always climbs down: nothing would catch a drop. */
export function descendConfigFor(descend: DescendConfig, enabled: boolean): DescendConfig {
  return enabled ? descend : { ...descend, climb_down_chance: 1 };
}

/**
 * The fall a lost sit starts. A descent still inside its window survey resumes on a stale
 * list and moves the window from under the faller, so the climb lets go before the drop.
 */
export function createSitLossFall(deps: {
  getClimber: () => { cancel(): void } | null;
  faller: { drop(): Promise<void> };
}): () => void {
  return () => {
    deps.getClimber()?.cancel();
    void deps.faller.drop();
  };
}

/** Who holds her still: the open Character menu, or her come-along onto the settings stage. */
export type LocomotionHolder = "menu" | "come-along";

export function wireLocomotion(deps: {
  bound?: boolean;
  bus: EventBus;
  renderer: Renderer;
  getConfig: () => AppConfig;
  dispatcher: Dispatcher;
  hitTest: Pick<HitTestController, "setMoving">;
  peekActive: () => boolean;
  fallSettings: FlagSettingsStore;
  climbSettings: FlagSettingsStore;
  dnd: Pick<FlagSettingsStore, "get">;
  agentNotifySettings: ReturnType<typeof createAgentNotifySettings>;
  vrmSelection: Pick<ReturnType<typeof createVrmSelection>, "getActive">;
  onStrollEnd: (bodyReleased: boolean) => void;
  /** The window-geometry wiring, once boot has applied the saved record; absent outside Tauri. */
  windowGeometry?: {
    onResizeApplied(bounds: { x: number; y: number; width: number; height: number }): void;
    onDragReleased(): Promise<void>;
  };
  register: (teardown: () => void) => void;
  log: Logger;
}): {
  walker: { isStrolling(): boolean };
  sitter: Sitter;
  dropSource: { noteUserDrag(): void; noteUserDragEnd(): void };
  setDragging(dragging: boolean): void;
  /** Cancels the five loops in the order a drag start and an agent move cancel them. */
  cancel(): void;
  /** Settles once a travel ended and a holder a drag let go has finished letting go. */
  abortTravel(): Promise<void>;
  /**
   * Holds her still while any holder holds her: cancels the loops, keeps a stroll, climb or perch
   * walk from starting, and pauses the keep-on-screen guard. `onAbort` runs once when an agent
   * move takes her, and for the come-along also when a drag does; the move waits for it.
   */
  hold(holder: LocomotionHolder, on: boolean, onAbort?: () => void | Promise<void>): void;
  /** Parks the real window over her position and the `via` origins. */
  widen(via: Array<{ x: number; y: number }>): Promise<Travel>;
  /** Leaves her seat on a window, as an agent move does. */
  release(): void;
  drop(opts: { landOnSeam: true }): Promise<void>;
  /** Calls `cb` after each Ctrl+wheel resize of her window; returns its disposer. */
  onResizeApplied(cb: () => void): () => void;
  /** Settles once the real window is wired. */
  ready: Promise<void>;
  /** The travel frame's window geometry reads, for the tools that capture the screen. */
  frame: {
    frameWindow(): FrameWindow;
    listMonitors(): Promise<ScreenMonitor[]>;
  };
  /** The avatar RPC executor once the stage created it, null until then. */
  getAvatarExecutor(): AvatarExecutor | null;
  /** The window she is seated on, or null. */
  armedSit(): { windowNumber: number } | null;
} {
  const {
    bus,
    renderer,
    getConfig,
    dispatcher,
    hitTest,
    peekActive,
    fallSettings,
    climbSettings,
    dnd,
    agentNotifySettings,
    vrmSelection,
    onStrollEnd,
    register,
    log,
  } = deps;

  // Set once the drop source exists — the travel frame pauses its keep-on-screen guard
  // while it parks the window itself.
  let windowSourcesRef: { setKeepOnScreenPaused(paused: boolean): void } | null = null;
  const travelFrame = wireTravelFrame({
    renderer,
    setKeepOnScreenPaused: (paused) => windowSourcesRef?.setKeepOnScreenPaused(paused),
    log,
  });
  register(travelFrame.dispose);

  // Ambient walking outranks nothing: a drag, an agent command or a reflex turn cancels a
  // stroll at once; an ordinary turn walks on. A hold keeps her still the way a drag does.
  let dragging = false;
  // Each holder, with the abort an agent move runs once.
  const holders = new Map<LocomotionHolder, (() => void | Promise<void>) | undefined>();
  const held = (): boolean => holders.size > 0;
  let letGo: Promise<unknown> = Promise.resolve();
  const abortHolders = (only?: LocomotionHolder): Promise<unknown> => {
    const aborts = [...holders].filter(([holder]) => !only || holder === only);
    for (const [holder] of aborts) holders.set(holder, undefined);
    letGo = Promise.all(aborts.map(([, onAbort]) => onAbort?.()));
    return letGo;
  };
  const resizeListeners = new Set<() => void>();
  let climberRef: { cancel(): void; descend(edge: DescentEdge): Promise<void> } | null = null;
  const walker = wireWalker({
    bus,
    renderer,
    travelFrame,
    getWalkConfig: () => getConfig().avatar.walk,
    getDescendConfig: () => getConfig().avatar.descend,
    getMotionKind: (id) => getConfig().motions[id]?.kind,
    isPeeking: () => peekActive(),
    isDragging: () => dragging || held(),
    setHitTestMoving: (moving) => hitTest.setMoving(moving),
    onStrollEnd,
    onDescend: (edge) => climberRef?.descend(edge),
    log,
  });
  register(walker.dispose);
  register(wireStrollReflexCancel({ dispatcher, walker }));

  // Set once each loop exists — the drop source and the faller are built before them.
  let percherRef: { cancel(): void; landOn(target: WindowRect): void } | null = null;

  // The seat transitions every seat entry and voluntary exit plays; one body, one sitter.
  const sitter = createSitter({ renderer });
  sitter.start();
  register(sitter.stop);

  // A character left mid-air drops to the first surface below her; the user outranks it.
  const faller = wireFaller({
    bus,
    renderer,
    travelFrame,
    isEnabled: () => fallSettings.get().enabled,
    isDndOn: () => dnd.get().enabled,
    getFallConfig: () => getConfig().avatar.fall,
    getMotionKind: (id) => getConfig().motions[id]?.kind,
    getFloorTolerancePx: () => getConfig().avatar.walk.floor_tolerance_px,
    getGestureCues: () => getConfig().avatar.gesture_cues,
    setHitTestMoving: (moving) => hitTest.setMoving(moving),
    onWindowLand: (target) => percherRef?.landOn(target),
    log,
  });
  register(faller.dispose);

  const windowSources = wireWindowSources({
    bound: deps.bound,
    bus,
    renderer,
    peekActive: () => peekActive(),
    getPeekConfig: () => getConfig().avatar.peek,
    getGestureCues: () => getConfig().avatar.gesture_cues,
    agentNotifySettings,
    getPosture: () => dispatcher.getPosture(),
    getVrm: () => {
      const active = vrmSelection.getActive();
      return { id: active.id, label: active.label ?? active.id };
    },
    noteAvatarMoved: () => dispatcher.noteAvatarMoved(),
    noteAgentMove: () => {
      walker.cancel();
      faller.cancel();
      climberRef?.cancel();
      percherRef?.cancel();
      sitter.cancel();
      const holdersLetGo = abortHolders();
      // A cancelled climb or stroll may still be unparking its travel.
      return Promise.all([holdersLetGo, travelFrame.abort()]).then(() => {});
    },
    onDragMiss: () => faller.drop({ landOnSeam: true, byUser: true }),
    onRelocated: () => faller.drop({ landOnSeam: true }),
    onSitLost: createSitLossFall({ getClimber: () => climberRef, faller }),
    sitDown: () => sitter.sitDown(null),
    onResizeApplied: (bounds) => {
      // On the settings stage her bounds are the slot's, not her own spot's.
      if (!holders.has("come-along")) deps.windowGeometry?.onResizeApplied(bounds);
      for (const cb of resizeListeners) cb();
    },
    onDragReleased: async () => {
      await deps.windowGeometry?.onDragReleased();
    },
    isTravelActive: () => travelFrame.travel.current() !== null,
    log,
  });
  windowSourcesRef = windowSources;
  register(windowSources.dispose);

  const percher = wirePercher({
    bus,
    renderer,
    getPerchWalkConfig: () => getConfig().avatar.perch_walk,
    getJumpConfig: () => getConfig().avatar.jump,
    getFallConfig: () => fallConfigFor(getConfig().avatar.fall, fallSettings.get().enabled),
    getMotionKind: (id) => getConfig().motions[id]?.kind,
    isBusy: () => held() || dispatcher.isPipelineBusy(),
    walker,
    sitter,
    dropSource: windowSources,
    onHostLost: () => faller.drop(),
    // A jump that loses its target leaves her mid-air, the same as a lost host does.
    onTargetLost: () => faller.drop(),
    // She walked past the edge on purpose; the drop is what she walked off for.
    onStepOff: () => faller.drop(),
    setHitTestMoving: (moving) => hitTest.setMoving(moving),
    log,
  });
  percherRef = percher;
  register(percher.dispose);

  // Ambient climbing: a wall now and then, a sit on top, then back down to the floor.
  const climber = wireClimber({
    bus,
    renderer,
    travelFrame,
    getClimbConfig: () => getConfig().avatar.climb,
    getDescendConfig: () =>
      descendConfigFor(getConfig().avatar.descend, fallSettings.get().enabled),
    getFallConfig: () => getConfig().avatar.fall,
    getWalkConfig: () => getConfig().avatar.walk,
    getMotionKind: (id) => getConfig().motions[id]?.kind,
    isPeeking: () => peekActive(),
    isDragging: () => dragging || held(),
    isBusy: dispatcher.isPipelineBusy,
    walker,
    faller,
    sitter,
    dropSource: windowSources,
    setHitTestMoving: (moving) => hitTest.setMoving(moving),
    log,
  });
  climberRef = climber;
  climber.setEnabled(climbSettings.get().enabled);
  register(climbSettings.subscribe((state) => climber.setEnabled(state.enabled)));
  register(climber.dispose);

  const cancel = (): void => {
    walker.cancel();
    faller.cancel();
    climber.cancel();
    percher.cancel();
    sitter.cancel();
  };

  return {
    walker,
    sitter,
    dropSource: windowSources,
    setDragging(next) {
      dragging = next;
      // Whoever moves her owns her: the drag ends her come-along.
      if (next) void abortHolders("come-along");
    },
    cancel,
    async abortTravel() {
      await travelFrame.abort();
      await letGo;
    },
    hold(holder, on, onAbort) {
      if (on) {
        cancel();
        holders.set(holder, onAbort);
      } else holders.delete(holder);
      windowSources.holdKeepOnScreen(held());
    },
    async widen(via) {
      const win = travelFrame.getWindow();
      const [pos, scale] = await Promise.all([win.outerPosition(), win.scaleFactor()]);
      // She ends where she starts: the travel only parks the window over the via origins.
      return travelFrame.travel.begin({ x: pos.x / scale, y: pos.y / scale }, via);
    },
    frame: {
      frameWindow: travelFrame.frameWindow,
      listMonitors: travelFrame.listMonitors,
    },
    release: () => windowSources.release(),
    drop: (opts) => faller.drop(opts),
    onResizeApplied(cb) {
      resizeListeners.add(cb);
      return () => resizeListeners.delete(cb);
    },
    ready: travelFrame.ready,
    isTravelling: () => false,
    onHoldReleased: (_cb: () => void) => () => {},
    getAvatarExecutor: () => windowSources.getAvatarExecutor(),
    armedSit: () => windowSources.armedSit(),
  };
}
