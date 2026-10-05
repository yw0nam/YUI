import type {
  FallConfig,
  JumpConfig,
  PerchWalkConfig,
} from "../../../config/validators/avatar/types";
import type { MotionKind, WindowRect } from "../../../contract";
import type { EventBus } from "../../../dispatcher/core/event-bus";
import type { WindowDropSource } from "../../../dispatcher/sources/gesture/window-drop/window-drop-source";
import { toScreenMonitor } from "../../../io/window/geometry/screen-geometry";
import type { Logger } from "../../../logger";
import type { Renderer } from "../../../renderer";
import { isTauri } from "../../../tauri-env";
import type { Sitter } from "../sitter";
import { createJumper } from "./jumper";
import { createPercher, type Percher, type PercherWindow } from "./percher";

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
  dropSource: Pick<
    WindowDropSource,
    "armedSit" | "suspendSit" | "resumeSit" | "abandonSit" | "adoptSit" | "release"
  >;
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
        });
      },
      onSit: (target, edgeLocalYpx) => {
        bus.push({
          source: "os_event_watcher",
          event_name: "avatar.window_sit",
          ts: Date.now(),
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
