import { createLogger } from "../logger";
import { isTauri } from "./tauri-env";

const log = createLogger("devtools-window");
const DEVTOOLS_LABEL = "devtools";
const DEVTOOLS_URL = "devtools.html";

export interface DevtoolsWindowEnv {
  isTauri: boolean;
  createTauriWindow: () => void;
  openBrowserWindow: () => void;
}

export function openDevtoolsWindow(env: DevtoolsWindowEnv): void {
  if (env.isTauri) env.createTauriWindow();
  else env.openBrowserWindow();
}

async function openTauriDevtoolsWindow(): Promise<void> {
  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const existing = await WebviewWindow.getByLabel(DEVTOOLS_LABEL);
    if (existing) {
      await existing.show();
      await existing.setFocus();
      return;
    }
    const window = new WebviewWindow(DEVTOOLS_LABEL, {
      url: DEVTOOLS_URL,
      title: "Developer Tools",
      width: 900,
      height: 640,
      minWidth: 720,
      minHeight: 520,
      resizable: true,
      decorations: true,
      transparent: false,
    });
    window.once("tauri://error", (event) =>
      log.error("devtools_window_create_error", { error: String(event) }),
    );
  } catch (error) {
    log.error("devtools_window_open_failed", { error: String(error) });
  }
}

function openBrowserDevtoolsWindow(): void {
  try {
    window.open(`/${DEVTOOLS_URL}`, "yui-devtools", "width=900,height=640,resizable=yes");
  } catch (error) {
    log.warn("devtools_window_browser_open_failed", { error: String(error) });
  }
}

export function createDevtoolsWindowOpener(): () => void {
  return () =>
    openDevtoolsWindow({
      isTauri: isTauri(),
      createTauriWindow: () => void openTauriDevtoolsWindow(),
      openBrowserWindow: openBrowserDevtoolsWindow,
    });
}
