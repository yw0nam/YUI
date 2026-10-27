/** Settings opens the main or bound companion window and shares storage change notifications. */

import { createLogger } from "../../../logger";
import type { SettingsPage } from "../../../settings/panels/settings-pages";
import { windowLabel } from "../../../settings/preset/pet-windows";
import { isTauri } from "../../../tauri-env";
import type { SettingsBridge } from "../../bridge/settings-bridge";

const log = createLogger("settings-window");

const SETTINGS_LABEL = "settings";
const SETTINGS_URL = "settings.html";
const SETTINGS_TITLE = "YUI Settings";

/** `--yui-panel-bg` (src/ui/tokens.css) in sRGB: the window's native background until its page paints. */
function panelBackground(theme: string | undefined): [number, number, number] {
  return theme === "hearth" ? [17, 12, 7] : [249, 246, 242];
}

type EmitSettingsPage = SettingsBridge["emitSettingsPage"];

/** `settings.html` with the preset and page the window opens on. */
function settingsUrl(boundId?: string | null, page?: SettingsPage): string {
  const query = [
    ...(boundId == null ? [] : [`preset=${encodeURIComponent(boundId)}`]),
    ...(page ? [`page=${page}`] : []),
  ].join("&");
  return query ? `${SETTINGS_URL}?${query}` : SETTINGS_URL;
}

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
async function openTauriSettingsWindow(
  boundId: string | null | undefined,
  page: SettingsPage | undefined,
  emitSettingsPage: EmitSettingsPage,
): Promise<void> {
  const label = boundId == null ? SETTINGS_LABEL : windowLabel("settings", boundId);
  const url = settingsUrl(boundId, page);
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
      emitSettingsPage({ preset: boundId ?? null, ...(page ? { page } : {}) });
      return;
    }
    // Window params mirror src-tauri/src/tray.rs open_settings — keep both in sync.
    const win = new WebviewWindow(label, {
      url,
      title: SETTINGS_TITLE,
      width: 760,
      height: 680,
      minWidth: 480,
      minHeight: 480,
      resizable: true,
      decorations: true,
      transparent: false,
      // Every window applies the same stored theme, so this window's is the new one's.
      backgroundColor: panelBackground(document.documentElement.dataset.theme),
    });
    win.once("tauri://error", (e) =>
      log.error("settings_window_create_error", { error: String(e) }),
    );
    win.once("tauri://destroyed", () => log.info("settings_window_closed", { label }));
  } catch (err) {
    log.error("settings_window_open_failed", { error: String(err) });
  }
}

function openBrowserSettingsWindow(boundId?: string | null, page?: SettingsPage): void {
  try {
    window.open(
      `/${settingsUrl(boundId, page)}`,
      boundId == null ? "yui-settings" : `yui-${windowLabel("settings", boundId)}`,
      "width=760,height=680",
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

/** Return opener with wired side effects. Branches to Tauri/browser per call; `page` is where the window lands. */
export function createSettingsWindowOpener(
  boundId: string | null | undefined,
  emitSettingsPage: EmitSettingsPage,
): (page?: SettingsPage) => void {
  return (page) => {
    openSettingsWindow({
      isTauri: isTauri(),
      createTauriWindow: () => void openTauriSettingsWindow(boundId, page, emitSettingsPage),
      openBrowserWindow: () => openBrowserSettingsWindow(boundId, page),
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
