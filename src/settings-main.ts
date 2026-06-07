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
import { createVoiceInputStatus, type VoiceInputState } from "./ui/voice-input-status";
import { resolveScreenSourceProvider } from "./io/tauri-screen";
import { wireStorageSync } from "./io/settings-window";
import { createSettingsBridge } from "./io/settings-bridge";
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

  // 메인 창과의 실시간 배선(Tauri 이벤트). 이 창엔 렌더러/STT가 없으므로 컨트롤은
  // 메인 창으로 보내고, 음성 상태는 메인 창에서 받아 반영한다. storage 폴백은 아래 유지.
  const bridge = createSettingsBridge();

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
    // 렌더러는 메인 창에 있으므로 게인 프리뷰를 브리지로 전달 → 메인 창 VRM 입이 움직인다.
    onGainPreview: (mouthOpen) => bridge.emitMouthPreview(mouthOpen),
    onGainPreviewEnd: () => bridge.emitMouthPreview(null),
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

  // 음성 토글(이 창 → 메인 STT)과 음성 상태 반영(메인 → 이 창). 컴포넌트가 로컬
  // voiceInputStatus를 구동하므로 그 변화를 메인으로 보내고, 메인의 실제 STT 상태를 받아 반영한다.
  let applyingRemoteVoice = false;
  voiceInputStatus.subscribe((snap) => {
    if (!applyingRemoteVoice) bridge.emitVoiceSet(snap.state !== "idle");
  });
  bridge.onVoiceState((s) => {
    applyingRemoteVoice = true;
    try {
      voiceInputStatus.set(s.state as VoiceInputState, s.detail);
    } finally {
      applyingRemoteVoice = false;
    }
  });

  // 설정 동기화(양방향, 루프 가드): 이 창 편집 → emit; 메인 알림 → 세 store 재로드.
  // 디바운스: 슬라이더 드래그/타이핑 버스트를 200ms 유휴 후 단일 cross-window 이벤트로 합친다.
  let applyingRemote = false;
  let broadcastTimer: ReturnType<typeof setTimeout> | null = null;
  const broadcastSettings = (): void => {
    if (applyingRemote) return;
    if (broadcastTimer) clearTimeout(broadcastTimer);
    broadcastTimer = setTimeout(() => {
      broadcastTimer = null;
      bridge.emitSettingsChanged();
    }, 200);
  };
  agentSettings.subscribe(broadcastSettings);
  lipsyncSettings.subscribe(broadcastSettings);
  screenshotSettings.subscribe(broadcastSettings);
  bridge.onSettingsChanged(() => {
    applyingRemote = true;
    try {
      for (const s of resyncStores) s.reloadFromStorage();
    } finally {
      applyingRemote = false;
    }
  });
}

void bootstrap();
