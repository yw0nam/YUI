/**
 * wire-window-geometry — the pet window keeps the size and position its user chose.
 *
 * The two user gestures that set the frame feed the store: a Ctrl+wheel resize writes the
 * size, a drag that lands writes the position. Boot applies the stored record once, before
 * the faller places the window and the bed scene parks it, so the park widens the restored
 * size and the drop starts from the restored position. Park, travel and keep-on-screen moves
 * are the app's own and never reach the store.
 */

import type { FrameWindow } from "../../io/window/geometry/travel-frame";
import type { WindowGeometrySettings } from "../../settings/window/window-geometry-settings";
import { isTauri } from "../../tauri-env";

/** The real pet window as the geometry wiring reads and writes it; null outside Tauri. */
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

export function wireWindowGeometry(deps: { store: WindowGeometrySettings; frame: FrameWindow }): {
  /** Applies the stored size, then position, once; awaiting it orders the boot placement. */
  apply(): Promise<void>;
  /** A Ctrl+wheel resize landed — the applied logical size joins the store. */
  onResizeApplied(size: { width: number; height: number }): void;
  /** A drag landed — the live window's position joins the store. */
  onLand(): Promise<void>;
  dispose(): void;
} {
  const { store, frame } = deps;
  let disposed = false;

  async function liveRect(): Promise<{ x: number; y: number; width: number; height: number }> {
    const [pos, size, sf] = await Promise.all([
      frame.outerPosition(),
      frame.outerSize(),
      frame.scaleFactor(),
    ]);
    const scale = sf > 0 ? sf : 1;
    return {
      x: pos.x / scale,
      y: pos.y / scale,
      width: size.width / scale,
      height: size.height / scale,
    };
  }

  return {
    async apply() {
      if (disposed) return;
      const { width, height, x, y } = store.get();
      if (width !== undefined && height !== undefined) {
        const live = await liveRect();
        if (disposed) return;
        await frame.setFrameLogical(x ?? live.x, y ?? live.y, width, height);
        return;
      }
      if (x !== undefined && y !== undefined) await frame.setPositionLogical(x, y);
    },
    onResizeApplied(size) {
      if (disposed) return;
      store.setSize(size);
    },
    async onLand() {
      if (disposed) return;
      const { x, y } = await liveRect();
      if (disposed) return;
      store.setPosition({ x, y });
    },
    dispose() {
      disposed = true;
    },
  };
}
