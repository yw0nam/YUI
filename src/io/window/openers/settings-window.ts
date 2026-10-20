/**
 * Settings pop-out window opener + cross-window settings sync.
 *
 * openSettingsWindow branches on injected env for Tauri/browser paths only (pure, testable).
 * createSettingsWindowOpener wires the real implementation — Tauri: WebviewWindow("settings"),
 * else: window.open. WebviewWindow dynamic-imported only within Tauri branch so vitest/browser
 * do not load the module.
 */

import { createLogger } from "../../../logger";
import { isTauri } from "../../../tauri-env";

const log = createLogger("settings-window");

const SETTINGS_LABEL = "settings";
const SETTINGS_URL = "settings.html";
const SETTINGS_TITLE = "YUI Settings";

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
async function openTauriSettingsWindow(boundId?: string | null): Promise<void> {
  const label = boundId == null ? SETTINGS_LABEL : `settings-${boundId}`;
  const url =
    boundId == null ? SETTINGS_URL : `${SETTINGS_URL}?preset=${encodeURIComponent(boundId)}`;
  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const existing = await WebviewWindow.getByLabel(label);
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
    const win = new WebviewWindow(label, {
      url,
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
    win.once("tauri://destroyed", () => log.info("settings_window_closed", { label }));
  } catch (err) {
    log.error("settings_window_open_failed", { error: String(err) });
  }
}

function openBrowserSettingsWindow(boundId?: string | null): void {
  try {
    window.open(
      boundId == null
        ? `/${SETTINGS_URL}`
        : `/${SETTINGS_URL}?preset=${encodeURIComponent(boundId)}`,
      boundId == null ? "yui-settings" : `yui-settings-${boundId}`,
      "width=480,height=660",
    );
  } catch (err) {
    log.warn("settings_window_browser_open_failed", { error: String(err) });
  }
}

/** Title the settings window. Tauri does not forward the document title, so set the native one too. */
export function titleSettingsWindow(title: string): void {
  document.title = title;
  if (!isTauri()) return;
  void (async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setTitle(title);
  })().catch((err) => log.warn("settings_title_set_failed", { error: String(err) }));
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
export function createSettingsWindowOpener(boundId?: string | null): () => void {
  return () => {
    openSettingsWindow({
      isTauri: isTauri(),
      createTauriWindow: () => void openTauriSettingsWindow(boundId),
      openBrowserWindow: () => openBrowserSettingsWindow(boundId),
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
