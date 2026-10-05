import { type PetWindow, toScreenMonitor } from "../../../io/window/geometry/screen-geometry";
import {
  createTravelFrame,
  type FrameWindow,
  type Travel,
} from "../../../io/window/geometry/travel-frame";
import type { Logger } from "../../../logger";
import type { Renderer } from "../../../renderer";
import { isTauri } from "../../../tauri-env";

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
export interface TravelFrameHandle {
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
