import { createAgentNotifySettings, localStorageAgentNotifyStorage } from "./agent-notify-settings";
import { createAgentSettings, localStorageAgentStorage } from "./agent-settings";
import { createSttKeySettings, createTtsKeySettings } from "./api-key-settings";
import { createCameraSettings, localStorageCameraStorage } from "./camera-settings";
import { createChatHistoryStore, localStorageChatHistoryStorage } from "./chat-history-store";
import { createChatKeySettings, localStorageChatKeyStorage } from "./chat-key-settings";
import { createEndpointsSettings, localStorageEndpointsStorage } from "./endpoints-settings";
import { createFillerSettings, localStorageFillerStorage } from "./filler-settings";
import { createGazeSettings, localStorageGazeStorage } from "./gaze-settings";
import { createHintSettings, localStorageHintStorage } from "./hint-settings";
import {
  createIdleThrottleSettings,
  localStorageIdleThrottleStorage,
} from "./idle-throttle-settings";
import { createLipsyncSettings, localStorageLipsyncStorage } from "./lipsync-settings";
import { createPresenceSettings, localStoragePresenceStorage } from "./presence-settings";
import { createProactiveSettings, localStorageProactiveStorage } from "./proactive-settings";
import {
  createRailCollapsedSettings,
  localStorageRailCollapsedStorage,
} from "./rail-collapsed-settings";
import { createRecentAppsSettings, localStorageRecentAppsStorage } from "./recent-apps-settings";
import { createScheduleSettings, localStorageScheduleStorage } from "./schedule-settings";
import { createScreenshotSettings, localStorageScreenshotStorage } from "./screenshot-settings";
import {
  createSessionDiagnosticsStore,
  localStorageSessionDiagnosticsStorage,
} from "./session-diagnostics";
import { createSessionStore, localStorageSessionStorage } from "./session-store";
import { createSttSettings, localStorageSttStorage } from "./stt-settings";
import { createTtsSettings, localStorageTtsStorage } from "./tts-settings";
import { createVadSettings, localStorageVadStorage } from "./vad-settings";

// localStorage-backed settings/state stores. Pure instantiation — no wiring, no renderer,
// no dispatcher. bootstrap() destructures the bag and owns the wiring (renderer, storage-sync).
export function createSettingsStores() {
  const screenshotSettings = createScreenshotSettings({
    storage: localStorageScreenshotStorage(),
  });
  // TTS 음성 출력 on/off. 기본 ON. OFF면 synth를 건너뛰고 표정/모션·말풍선만 표시.
  const ttsSettings = createTtsSettings({
    storage: localStorageTtsStorage(),
  });
  // STT 음성입력 on/off 의도. 기본 OFF. 켜둔 채 종료하면 다음 실행에서 자동 재개한다.
  const sttSettings = createSttSettings({
    storage: localStorageSttStorage(),
  });
  // 유휴 절전(30fps 캡) on/off. 기본 ON.
  const idleThrottleSettings = createIdleThrottleSettings({
    storage: localStorageIdleThrottleStorage(),
  });
  // 주도적 반응(무대화 N분 → proactive.<id>) 설정. 소스 firing만 게이팅 — 구독은 멈추지 않는다.
  const proactiveSettings = createProactiveSettings({
    storage: localStorageProactiveStorage(),
  });
  // 시간대 인사(HH:MM → schedule.<id>) 설정.
  const scheduleSettings = createScheduleSettings({
    storage: localStorageScheduleStorage(),
  });
  // Agent completion 알림 on/off + 수신 포트. 소스 firing만 게이팅.
  const agentNotifySettings = createAgentNotifySettings({
    storage: localStorageAgentNotifyStorage(),
  });
  // Presence window threshold — "present when idle ≤ N ms". Shared by proactive/agent sources.
  const presenceSettings = createPresenceSettings({ storage: localStoragePresenceStorage() });
  // Recent-apps buffer cap — os-context caps its app-switch buffer at this value.
  const recentAppsSettings = createRecentAppsSettings({
    storage: localStorageRecentAppsStorage(),
  });
  const lipsyncSettings = createLipsyncSettings({
    storage: localStorageLipsyncStorage(),
  });
  const vadSettings = createVadSettings({ storage: localStorageVadStorage() });
  const agentSettings = createAgentSettings({
    storage: localStorageAgentStorage(),
  });
  // TTFT 추임새(생각중 모션 + 필러 발화) 설정. 두 창이 wireStorageSync로 동기화.
  const fillerSettings = createFillerSettings({
    storage: localStorageFillerStorage(),
  });
  // 세션 연속성 store: 회전 id 포인터 + 진단(used/window/last-compression). 두 창이
  // wireStorageSync로 동기화하므로 다른 store들과 함께 일찍 만든다(config/dispatcher 비의존).
  const sessionStore = createSessionStore(localStorageSessionStorage());
  const sessionDiagnostics = createSessionDiagnosticsStore(localStorageSessionDiagnosticsStorage());
  // 통합 대화 transcript — 두 프로토콜 모드 모두 append하고 CC 모드만 여기서 송신분을 뽑는다.
  // "새 대화 시작"이 session store들과 함께 비운다(quick-controls). 두 창이 wireStorageSync로 동기화.
  const chatHistoryStore = createChatHistoryStore({ storage: localStorageChatHistoryStorage() });
  // 사용자 편집 엔드포인트 오버라이드: localStorage가 bundled config를 덮는다(빈 값=폴백).
  const endpointsSettings = createEndpointsSettings({
    storage: localStorageEndpointsStorage(),
  });
  // 런타임 chat API 키 오버라이드: localStorage가 build-time 키를 덮는다(빈 값=폴백). 값은 시크릿.
  const chatKeySettings = createChatKeySettings({
    storage: localStorageChatKeyStorage(),
  });
  // 런타임 STT/openai-TTS 키 오버라이드(localStorage). 빈 값=.env.local fallback. 값은 시크릿.
  const sttKeySettings = createSttKeySettings();
  const ttsKeySettings = createTtsKeySettings();
  // 카메라 줌: persist된 배율을 부트 시 적용하고, 변경(휠/크로스윈도우)마다 렌더러로 흘린다.
  const cameraSettings = createCameraSettings({
    storage: localStorageCameraStorage(),
  });
  // 카메라 시선 맞춤(gaze) on/off. 기본 ON. 변경(토글/크로스윈도우)마다 렌더러로 흘린다.
  const gazeSettings = createGazeSettings({ storage: localStorageGazeStorage() });
  // First-run 온보딩 힌트 — 최초 1회만 노출되는 flag.
  const hintSettings = createHintSettings({ storage: localStorageHintStorage() });
  const railCollapsedSettings = createRailCollapsedSettings({
    storage: localStorageRailCollapsedStorage(),
  });

  return {
    screenshotSettings,
    ttsSettings,
    sttSettings,
    idleThrottleSettings,
    proactiveSettings,
    scheduleSettings,
    agentNotifySettings,
    presenceSettings,
    recentAppsSettings,
    lipsyncSettings,
    vadSettings,
    agentSettings,
    fillerSettings,
    sessionStore,
    sessionDiagnostics,
    chatHistoryStore,
    endpointsSettings,
    chatKeySettings,
    sttKeySettings,
    ttsKeySettings,
    cameraSettings,
    gazeSettings,
    hintSettings,
    railCollapsedSettings,
  };
}
