/** Saves the pet window's size and position after the OS drag ends and after a Ctrl+wheel resize, and applies the saved record once at boot, clamped on screen, before the faller places the window and the bed scene parks it. */

import { tauriFrameWindow } from "../../io/window/geometry/tauri-frame-window";
import type { FrameWindow } from "../../io/window/geometry/travel-frame";
import {
  createWindowGeometrySettings,
  localStorageWindowGeometryStorage,
  type WindowGeometrySettings,
} from "../../settings/panels/window-geometry-settings";
import { isTauri } from "../../tauri-env";

/** The hooks the producers call: a resize's applied size and an OS drag release. */
export interface WindowGeometryHooks {
  onResizeApplied(size: { width: number; height: number }): void;
  onLand(): Promise<void>;
}

/** The store-and-frame core: boot apply plus the two producer hooks. Injectable for tests. */
export function createWindowGeometry(deps: { store: WindowGeometrySettings; frame: FrameWindow }): {
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

/** The whole wiring: label, store and frame by window label, applied once before placement. */
export async function wireWindowGeometry(deps: {
  register: (teardown: () => void) => void;
}): Promise<WindowGeometryHooks | null> {
  if (!isTauri()) return null;
  const frame = await tauriFrameWindow();
  if (!frame) return null;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const store = createWindowGeometrySettings({
    storage: localStorageWindowGeometryStorage(getCurrentWindow().label),
  });
  const wiring = createWindowGeometry({ store, frame });
  deps.register(wiring.dispose);
  await wiring.apply();
  return wiring;
}
