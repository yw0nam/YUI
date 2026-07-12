/**
 * 설정 팝아웃 창 오프너 + 창 간 설정 동기화.
 *
 * openSettingsWindow는 주입된 env로 Tauri/브라우저 경로만 가른다(순수, 테스트 가능).
 * createSettingsWindowOpener는 실제 구현을 배선한다 — Tauri면 WebviewWindow("settings"),
 * 아니면 window.open. WebviewWindow는 Tauri 분기 안에서만 dynamic import해 vitest/브라우저가
 * 모듈을 로드하지 않게 한다.
 */

import { createLogger } from "../logger";

const log = createLogger("settings-window");

const SETTINGS_LABEL = "settings";
const SETTINGS_URL = "settings.html";
const SETTINGS_TITLE = "YUI 설정";

export interface SettingsWindowEnv {
  isTauri: boolean;
  /** 실제 구현은 WebviewWindow를 띄운다. */
  createTauriWindow: () => void;
  /** 실제 구현은 window.open으로 폴백 창을 띄운다. */
  openBrowserWindow: () => void;
}

/** isTauri면 Tauri 창, 아니면 브라우저 창. 부수효과는 env가 들고 있어 단위 테스트가 쉽다. */
export function openSettingsWindow(env: SettingsWindowEnv): void {
  if (env.isTauri) {
    env.createTauriWindow();
  } else {
    env.openBrowserWindow();
  }
}

/** Tauri 런타임 여부 — withGlobalTauri 환경에서 항상 주입되는 내부 핸들로 판별. */
function detectTauri(): boolean {
  return !!(globalThis as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}

/** 이미 떠 있으면 포커스/표시, 없으면 새로 생성. 어떤 단계도 throw하지 않는다. */
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

/** 설정 창 자신을 닫는다 — Tauri면 현재 창 close, 아니면 window.close() 폴백. throw하지 않는다. */
export function closeSettingsWindow(): void {
  if (detectTauri()) {
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

/** 실제 부수효과를 배선한 오프너를 반환한다. 호출 시 한 번씩 Tauri/브라우저로 분기. */
export function createSettingsWindowOpener(): () => void {
  return () => {
    openSettingsWindow({
      isTauri: detectTauri(),
      createTauriWindow: () => void openTauriSettingsWindow(),
      openBrowserWindow: openBrowserSettingsWindow,
    });
  };
}

/** 창 간 동기화: 다른 창의 localStorage write(`storage` 이벤트)에 각 store를 재로드. disposer 반환. */
export function wireStorageSync(stores: ReadonlyArray<{ reloadFromStorage(): void }>): () => void {
  const onStorage = (): void => {
    for (const s of stores) s.reloadFromStorage();
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}
