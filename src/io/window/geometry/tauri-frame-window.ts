/**
 * tauri-frame-window — the real pet window as the window movers read and write it.
 */

import { isTauri } from "../../../tauri-env";
import type { FrameWindow } from "./travel-frame";

/** The real window's frame seam; null outside Tauri (Vite dev), where no window moves. */
export async function tauriFrameWindow(): Promise<FrameWindow | null> {
  if (!isTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const { LogicalPosition } = await import("@tauri-apps/api/dpi");
  const win = getCurrentWindow();
  return {
    outerPosition: () => win.outerPosition(),
    outerSize: () => win.outerSize(),
    scaleFactor: () => win.scaleFactor(),
    setPositionLogical: (x, y) => win.setPosition(new LogicalPosition(x, y)),
    setFrameLogical: (x, y, width, height) =>
      invoke("set_frame_logical", { x, y, width, height }) as Promise<void>,
  };
}
