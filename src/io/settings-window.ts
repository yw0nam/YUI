/**
 * Settings pop-out window opener + cross-window settings sync.
 *
 * openSettingsWindow branches on injected env for Tauri/browser paths only (pure, testable).
 * createSettingsWindowOpener wires the real implementation — Tauri: WebviewWindow("settings"),
 * else: window.open. WebviewWindow dynamic-imported only within Tauri branch so vitest/browser
 * do not load the module.
 */

import { createLogger } from "../logger";
import { isTauri } from "./tauri-env";

const log = createLogger("settings-window");

const SETTINGS_LABEL = "settings";
const SETTINGS_URL = "settings.html";
const SETTINGS_TITLE = "YUI 설정";

export interface SettingsWindowEnv {
  isTauri: boolean;
  /** Real implementation launches WebviewWindow. */
  createTauriWindow: () => void;
  /** Real implementation launches fallback window via window.open. */
  openBrowserWindow: () => void;
}

/** Tauri window if isTauri, else browser window. Side effects held by env for easy unit testing. */
export function openSettingsWindow(env: SettingsWindowEnv): void {
  if (env.isTauri) {
    env.createTauriWindow();
  } else {
    env.openBrowserWindow();
  }
}

/** If already open, focus and show; else create new. No step throws. */
async function openTauriSettingsWindow(): Promise<void> {
  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const existing = await WebviewWindow.getByLabel(SETTINGS_LABEL);
    if (existing) {
      try {
        await existing.show();
        await existing.setFocus();
      } catch (err) {
        log.warn("settings_window_focus_failed", { error: String(err) });
      }
      return;
    }
    // Window params mirror src-tauri/src/tray.rs open_settings — keep both in sync.
    const win = new WebviewWindow(SETTINGS_LABEL, {
      url: SETTINGS_URL,
      title: SETTINGS_TITLE,
      width: 480,
      height: 660,
      minWidth: 380,
      minHeight: 480,
      resizable: true,
      decorations: true,
      transparent: false,
    });
    win.once("tauri://error", (e) =>
      log.error("settings_window_create_error", { error: String(e) }),
    );
  } catch (err) {
    log.error("settings_window_open_failed", { error: String(err) });
  }
}

function openBrowserSettingsWindow(): void {
  try {
    window.open(`/${SETTINGS_URL}`, "yui-settings", "width=480,height=660");
  } catch (err) {
    log.warn("settings_window_browser_open_failed", { error: String(err) });
  }
}

/** Close the settings window itself — Tauri: close current window, else: window.close() fallback. Does not throw. */
export function closeSettingsWindow(): void {
  if (isTauri()) {
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().close();
      } catch (err) {
        log.warn("settings_window_close_failed", { error: String(err) });
      }
    })();
    return;
  }
  try {
    window.close();
  } catch (err) {
    log.warn("settings_window_close_failed", { error: String(err) });
  }
}

/** Return opener with wired side effects. Branches to Tauri/browser per call. */
export function createSettingsWindowOpener(): () => void {
  return () => {
    openSettingsWindow({
      isTauri: isTauri(),
      createTauriWindow: () => void openTauriSettingsWindow(),
      openBrowserWindow: openBrowserSettingsWindow,
    });
  };
}

/** Cross-window sync: reload each store on other window's localStorage write (`storage` event). Return disposer. */
export function wireStorageSync(stores: ReadonlyArray<{ reloadFromStorage(): void }>): () => void {
  const onStorage = (): void => {
    for (const s of stores) s.reloadFromStorage();
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}
