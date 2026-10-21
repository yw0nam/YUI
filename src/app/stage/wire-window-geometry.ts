/** Saves the pet window's size and position after the OS drag ends and after a Ctrl+wheel resize, and applies the saved record once at boot, clamped on screen, before the faller places the window and the bed scene parks it. */

import {
  clampToWorkArea,
  monitorAtLogical,
  type ScreenMonitor,
  toScreenMonitor,
} from "../../io/window/geometry/screen-geometry";
import { tauriFrameWindow } from "../../io/window/geometry/tauri-frame-window";
import type { FrameWindow } from "../../io/window/geometry/travel-frame";
import {
  createWindowGeometrySettings,
  localStorageWindowGeometryStorage,
  type WindowGeometrySettings,
} from "../../settings/panels/window-geometry-settings";
import { isTauri } from "../../tauri-env";

/** The hooks the producers call: a resize's applied bounds and an OS drag release. */
export interface WindowGeometryHooks {
  onResizeApplied(bounds: { x: number; y: number; width: number; height: number }): void;
  onDragReleased(): Promise<void>;
}

/** The store-and-frame core: boot apply plus the two producer hooks. Injectable for tests. */
export function createWindowGeometry(deps: {
  store: WindowGeometrySettings;
  frame: FrameWindow;
  listMonitors?: () => Promise<ScreenMonitor[]>;
}): {
  /** Applies the stored size, then position, once; awaiting it orders the boot placement. */
  apply(): Promise<void>;
  /** A Ctrl+wheel resize landed — the applied logical bounds join the store. */
  onResizeApplied(bounds: { x: number; y: number; width: number; height: number }): void;
  /** The OS drag release settled — the live window's position joins the store. */
  onDragReleased(): Promise<void>;
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

  /** The rect clamped into the work area of the monitor holding its center; null when none does. */
  async function clampToScreen(
    x: number,
    y: number,
    width: number,
    height: number,
  ): Promise<{ x: number; y: number } | null> {
    if (!deps.listMonitors) return null;
    const monitor = monitorAtLogical(await deps.listMonitors(), x + width / 2, y + height / 2);
    if (!monitor) return null;
    const sf = monitor.scaleFactor;
    return clampToWorkArea(
      x,
      y,
      width,
      height,
      monitor.workArea.position.x / sf,
      monitor.workArea.position.y / sf,
      monitor.workArea.size.width / sf,
      monitor.workArea.size.height / sf,
    );
  }

  const nextFrame = (): Promise<void> =>
    new Promise((resolve) => window.requestAnimationFrame(() => resolve()));

  /** One frame past the page reaching the applied size, so the renderer's refit has run. */
  async function waitRefit(width: number, height: number): Promise<void> {
    for (let frame = 0; frame < 60; frame += 1) {
      if (window.innerWidth === Math.round(width) && window.innerHeight === Math.round(height)) {
        break;
      }
      await nextFrame();
    }
    await nextFrame();
  }

  return {
    async apply() {
      if (disposed) return;
      const saved = store.get();
      if (saved.width === undefined || saved.height === undefined) {
        if (saved.x === undefined || saved.y === undefined) return;
        const live = await liveRect();
        if (disposed) return;
        const placed = await clampToScreen(saved.x, saved.y, live.width, live.height);
        if (disposed || !placed) return;
        await frame.setPositionLogical(placed.x, placed.y);
        return;
      }
      const live = await liveRect();
      if (disposed) return;
      const placed = await clampToScreen(
        saved.x ?? live.x,
        saved.y ?? live.y,
        saved.width,
        saved.height,
      );
      if (disposed || !placed) {
        // No monitor holds the restored rect — the size alone applies at the live position.
        await frame.setFrameLogical(live.x, live.y, saved.width, saved.height);
        await waitRefit(saved.width, saved.height);
        return;
      }
      await frame.setFrameLogical(placed.x, placed.y, saved.width, saved.height);
      await waitRefit(saved.width, saved.height);
    },
    onResizeApplied(bounds) {
      if (disposed) return;
      store.setBounds(bounds);
    },
    async onDragReleased() {
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
  const { getCurrentWindow, availableMonitors } = await import("@tauri-apps/api/window");
  const store = createWindowGeometrySettings({
    storage: localStorageWindowGeometryStorage(getCurrentWindow().label),
  });
  const wiring = createWindowGeometry({
    store,
    frame,
    listMonitors: async () => (await availableMonitors()).map(toScreenMonitor),
  });
  deps.register(wiring.dispose);
  await wiring.apply();
  return wiring;
}
