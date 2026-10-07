import type { FallConfig, GestureCuesConfig } from "../../../config/validators/avatar/types";
import type { MotionKind, WindowRect } from "../../../contract";
import type { EventBus } from "../../../dispatcher/core/event-bus";
import { toScreenMonitor } from "../../../io/window/geometry/screen-geometry";
import type { Logger } from "../../../logger";
import type { Renderer } from "../../../renderer";
import { isTauri } from "../../../tauri-env";
import type { TravelFrameHandle } from "../travel/wire-travel-frame";
import { createFaller, type DropOptions, type Faller } from "./faller";

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
}): {
  drop(opts?: DropOptions): Promise<void>;
  cancel(): void;
  dispose(): void;
  /** Resolves once the boot placement has settled, or at once where none runs. */
  placed: Promise<void>;
} {
  const { bus, renderer, log } = deps;
  let faller: Faller | null = null;
  let disposed = false;
  let resolvePlaced!: () => void;
  const placed = new Promise<void>((resolve) => {
    resolvePlaced = resolve;
  });
  const handle = {
    drop: async (opts?: DropOptions) => {
      if (deps.isEnabled()) await faller?.drop(opts);
    },
    cancel: () => faller?.cancel(),
    dispose: () => {
      disposed = true;
      faller?.stop();
    },
    placed,
  };
  if (!isTauri()) {
    resolvePlaced();
    return handle;
  }
  void (async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const { availableMonitors } = await import("@tauri-apps/api/window");
    await deps.travelFrame.ready;
    if (disposed) return;
    const createdFaller = createFaller({
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
          payload: {
            cue_id: "dropped",
            label: cue.label,
            ...(cue.context !== undefined ? { context: cue.context } : {}),
            height_px: Math.round(heightPx),
          },
        });
      },
    });
    faller = createdFaller;
    // The OS chooses the initial position; placement is not a user-controlled fall.
    await createdFaller.drop({ place: true });
  })()
    .catch((err) => log.warn("faller_start_failed", { degrade: true, error: String(err) }))
    .finally(resolvePlaced);
  return handle;
}
