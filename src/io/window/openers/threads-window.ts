/** Main's Threads window: created hidden once, sent the chip's screen rect on each open, and its closed report passed on. */

import type { ScreenRect } from "../../../contract";
import { createLogger } from "../../../logger";
import { isTauri } from "../../../tauri-env";
import type { SettingsBridge } from "../../bridge/settings-bridge";
import { createReadyWindowController } from "./ready-window";

const log = createLogger("threads-window");

/** The Threads window's label. */
export const THREADS_WINDOW_LABEL = "threads";

function createTauriThreadsWindow(): void {
  void (async () => {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const win = new WebviewWindow(THREADS_WINDOW_LABEL, {
      url: "threads.html",
      title: "YUI",
      resizable: false,
      decorations: false,
      transparent: true,
      shadow: false,
      alwaysOnTop: false,
      skipTaskbar: true,
      visible: false,
      focus: false,
      // The first click into the unfocused window lands as well as focusing it (macOS).
      acceptFirstMouse: true,
    });
    void win.once("tauri://error", (event) =>
      log.error("threads_window_create_error", { error: String(event) }),
    );
  })();
}

/** A rect in this window's viewport moved to screen logical px. */
async function toScreen(rect: ScreenRect): Promise<ScreenRect> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  const [inner, scale] = await Promise.all([win.innerPosition(), win.scaleFactor()]);
  return { ...rect, x: inner.x / scale + rect.x, y: inner.y / scale + rect.y };
}

export function createThreadsWindowController(deps: {
  bridge: Pick<SettingsBridge, "emitThreadsOpen" | "onThreadsReady" | "onThreadsClosed">;
  /** The window is hidden again, or never opened. */
  onClosed(): void;
}): {
  /** Opens the window grown out of `chip`, a rect in this window's viewport; false where no window opens. */
  open(chip: ScreenRect): boolean;
  dispose(): void;
} {
  const ready = createReadyWindowController({
    label: THREADS_WINDOW_LABEL,
    create: createTauriThreadsWindow,
    emitOpen: deps.bridge.emitThreadsOpen,
    onReady: deps.bridge.onThreadsReady,
    onError: deps.onClosed,
  });
  const offClosed = deps.bridge.onThreadsClosed(deps.onClosed);
  return {
    open(chip) {
      if (!isTauri()) return false;
      toScreen(chip).then(
        (screen) => ready.open({ chip: screen }),
        (error) => {
          log.error("threads_window_open_failed", { error: String(error) });
          deps.onClosed();
        },
      );
      return true;
    },
    dispose() {
      ready.dispose();
      offClosed();
    },
  };
}
