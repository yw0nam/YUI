import type { ClimbConfig, DescendConfig, FallConfig, WalkConfig } from "../../../config/load";
import type { MotionKind, WindowRect } from "../../../contract";
import type { EventBus } from "../../../dispatcher/core/event-bus";
import type { WindowDropSource } from "../../../dispatcher/sources/gesture/window-drop/window-drop-source";
import { type DescentEdge, toScreenMonitor } from "../../../io/window/geometry/screen-geometry";
import type { Logger } from "../../../logger";
import type { Renderer } from "../../../renderer";
import { isTauri } from "../../../tauri-env";
import type { Sitter } from "../sitter";
import type { TravelFrameHandle } from "../travel/wire-travel-frame";
import type { ClimbTarget } from "./climb-geometry";
import { type Climber, createClimber } from "./climber";

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
  dropSource: Pick<WindowDropSource, "adoptSit" | "armedSit" | "release">;
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
