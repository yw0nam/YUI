/**
 * A frameless companion column window (the message window, the unified chat window): OS focus,
 * the OS drag, the height that tracks the column's content at the column width, the moved-position
 * report, and keep-on-screen. Each failure logs with the window it happened in.
 */

import { createLogger } from "../../../logger";
import { isTauri } from "../../../tauri-env";
import { COMPANION_COLUMN_WIDTH } from "./companion-position";
import { attachKeepOnScreen } from "./keep-on-screen";
import { toScreenMonitor } from "./screen-geometry";

const log = createLogger("companion-column");

/** The companion window a log line names. */
export type CompanionWindow = "message" | "unified" | "quick-card";

/** Take OS focus so typing lands in this window's field. */
export async function focusWindow(window: CompanionWindow): Promise<void> {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setFocus();
  } catch (error) {
    log.warn("focus_failed", { window, error: String(error) });
  }
}

/** OS-native window drag from the handle. */
export async function startDragging(window: CompanionWindow): Promise<void> {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().startDragging();
  } catch (error) {
    log.warn("drag_failed", { window, error: String(error) });
  }
}

/** Height tracks the column's content at the column width, and every move reports the window's outer position (physical px). */
export async function wireCompanionColumn(
  window: CompanionWindow,
  root: HTMLElement,
  onMoved: (x: number, y: number) => void,
  isDisposed: () => boolean = () => false,
): Promise<() => void> {
  const { availableMonitors, getCurrentWindow } = await import("@tauri-apps/api/window");
  const { LogicalSize, PhysicalPosition } = await import("@tauri-apps/api/dpi");
  const win = getCurrentWindow();

  let lastHeight = 0;
  const observer = new ResizeObserver(() => {
    const height = Math.ceil(root.getBoundingClientRect().height);
    if (height <= 0 || height === lastHeight) return;
    lastHeight = height;
    void win
      .setSize(new LogicalSize(COMPANION_COLUMN_WIDTH, height))
      .catch((error) => log.warn("resize_failed", { window, error: String(error) }));
  });
  observer.observe(root);

  const unlistenMoved = await win.onMoved(({ payload }) => {
    if (!isDisposed()) onMoved(payload.x, payload.y);
  });

  const keepOnScreen = await attachKeepOnScreen(
    {
      outerPosition: () => win.outerPosition(),
      outerSize: () => win.outerSize(),
      setPositionPhysical: (x, y) => win.setPosition(new PhysicalPosition(x, y)),
      onMoved: (cb) => win.onMoved(() => cb()),
      onResized: (cb) => win.onResized(() => cb()),
    },
    async () => (await availableMonitors()).map(toScreenMonitor),
    { wholeWindow: true },
  );

  return () => {
    observer.disconnect();
    unlistenMoved();
    keepOnScreen.dispose();
  };
}
