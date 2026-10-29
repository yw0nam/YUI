/** The Threads window's native side: sized and placed beside the main pet window, shown and focused, hidden. */

import type { ScreenRect } from "../../contract";
import {
  logicalWorkArea,
  monitorAtLogical,
  toScreenMonitor,
} from "../../io/window/geometry/screen-geometry";
import { chipInWindow, threadsWindowRect } from "../../io/window/geometry/threads-position";

/** Places and shows the window for a chip at `chip` (screen logical px); resolves where the grow starts, in window-local px. */
export async function showThreadsWindow(chip: ScreenRect): Promise<ScreenRect> {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const { availableMonitors, getCurrentWindow } = await import("@tauri-apps/api/window");
  const { LogicalPosition, LogicalSize } = await import("@tauri-apps/api/dpi");
  const main = await WebviewWindow.getByLabel("main");
  if (!main) throw new Error("main window not found");
  const [position, size, scale, monitors] = await Promise.all([
    main.outerPosition(),
    main.outerSize(),
    main.scaleFactor(),
    availableMonitors(),
  ]);
  const screens = monitors.map(toScreenMonitor);
  const monitor = monitorAtLogical(screens, chip.x, chip.y) ?? screens[0];
  if (!monitor) throw new Error("no monitor");
  const rect = threadsWindowRect({
    pet: {
      x: position.x / scale,
      y: position.y / scale,
      width: size.width / scale,
      height: size.height / scale,
    },
    workArea: logicalWorkArea(monitor),
  });
  const win = getCurrentWindow();
  await win.setSize(new LogicalSize(rect.width, rect.height));
  await win.setPosition(new LogicalPosition(rect.x, rect.y));
  await win.show();
  await win.setFocus();
  return chipInWindow(chip, rect);
}

export async function hideThreadsWindow(): Promise<void> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().hide();
}
