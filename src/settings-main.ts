/**
 * 설정 창(팝아웃) 부트스트랩 — settings.html 진입점.
 *
 * 펫 창의 quick-controls를 variant:"window"로 단독 마운트한다. 렌더러/VRM 없음(설정 전용).
 * 메인 창과의 동기화: localStorage write를 `storage` 이벤트로 받아 store를 재로드하고,
 * 포커스 시에도 한 번 재로드한다(Tauri는 창 간 storage 이벤트를 못 쏠 수 있음).
 */

import "./styles.css";
import { createLogger, initLogger } from "./logger";
import { createQuickControls } from "./ui/quick-controls";
import { createScreenshotSettings, localStorageScreenshotStorage } from "./io/screenshot-settings";
import { createLipsyncSettings, localStorageLipsyncStorage } from "./io/lipsync-settings";
import { createAgentSettings, localStorageAgentStorage } from "./io/agent-settings";
import { createVoiceInputStatus } from "./ui/voice-input-status";
import { resolveScreenSourceProvider } from "./io/tauri-screen";
import { wireStorageSync } from "./io/settings-window";
import { createConfigStore } from "./config";

const log = createLogger("settings-bootstrap");

async function bootstrap(): Promise<void> {
  await initLogger();
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) {
    throw new Error("#app mount point not found");
  }

  const screenshotSettings = createScreenshotSettings({ storage: localStorageScreenshotStorage() });
  const lipsyncSettings = createLipsyncSettings({ storage: localStorageLipsyncStorage() });
  const agentSettings = createAgentSettings({ storage: localStorageAgentStorage() });
  const voiceInputStatus = createVoiceInputStatus();
  const sourceProvider = resolveScreenSourceProvider();

  // 기본 지침 placeholder를 위한 config는 best-effort로만 로드한다(실패 → 일반 placeholder).
  const config = createConfigStore();
  let configLoaded = false;
  try {
    await config.load();
    configLoaded = true;
  } catch (err) {
    log.warn("config 로드 실패 — 기본 지침 placeholder 없이 진행", err);
  }

  const quickControls = createQuickControls({
    mount: app,
    variant: "window",
    agentSettings,
    settings: screenshotSettings,
    sourceProvider,
    voiceStatus: voiceInputStatus,
    lipsync: lipsyncSettings,
    // 설정 창에는 렌더러가 없으므로 게인 프리뷰는 no-op.
    onGainPreview: () => {},
    onGainPreviewEnd: () => {},
    getDefaultInstructions: () => {
      if (!configLoaded) return undefined;
      try {
        return config.get().endpoints.chat_instructions;
      } catch {
        return undefined;
      }
    },
  });
  // window variant는 생성 시 자동으로 열리지만 멱등하므로 방어적으로 한 번 더 호출.
  quickControls.open();

  // 메인 창의 편집을 반영: cross-window storage 이벤트 + 포커스 폴백.
  const resyncStores = [agentSettings, lipsyncSettings, screenshotSettings];
  wireStorageSync(resyncStores);
  window.addEventListener("focus", () => {
    for (const s of resyncStores) s.reloadFromStorage();
  });
}

void bootstrap();
