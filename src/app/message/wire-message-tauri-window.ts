import { attachKeepOnScreen } from "../../io/window/geometry/keep-on-screen";
import { toScreenMonitor } from "../../io/window/geometry/screen-geometry";
import { createLogger } from "../../logger";
import { isTauri } from "../../tauri-env";

const log = createLogger("message-bootstrap");

/** Take OS focus so typing lands in this window's field. */
export async function focusWindow(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setFocus();
  } catch (error) {
    log.warn("message_window_focus_failed", { error: String(error) });
  }
}

/** OS-native window drag from the plate. */
export async function startDragging(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().startDragging();
  } catch (error) {
    log.warn("message_window_drag_failed", { error: String(error) });
  }
}

/** A frameless column window: its height tracks the content at a fixed width, and every move reports its outer position (physical px). */
export async function wireTauriWindow(
  root: HTMLElement,
  frame: { width: number; onMoved(x: number, y: number): void },
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
      .setSize(new LogicalSize(frame.width, height))
      .catch((error) => log.warn("message_window_resize_failed", { error: String(error) }));
  });
  observer.observe(root);

  const unlistenMoved = await win.onMoved(({ payload }) => {
    if (!isDisposed()) frame.onMoved(payload.x, payload.y);
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
