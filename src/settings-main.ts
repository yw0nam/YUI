/**
 * 설정 창(팝아웃) 부트스트랩 — settings.html 진입점.
 *
 * 펫 창의 quick-controls를 variant:"window"로 단독 마운트한다. 렌더러/VRM 없음(설정 전용).
 * 메인 창과의 동기화: localStorage write를 `storage` 이벤트로 받아 store를 재로드하고,
 * 포커스 시에도 한 번 재로드한다(Tauri는 창 간 storage 이벤트를 못 쏠 수 있음).
 */

import "./styles.css";
import { createConfigStore } from "./config";
import { createAgentSettings, localStorageAgentStorage } from "./io/agent-settings";
import { resolveAssetUrl } from "./io/asset-url";
import { selectFetch } from "./io/chat-client";
import { createChatKeySettings, localStorageChatKeyStorage } from "./io/chat-key-settings";
import { createEndpointsSettings, localStorageEndpointsStorage } from "./io/endpoints-settings";
import { createFillerSettings, localStorageFillerStorage } from "./io/filler-settings";
import {
  createIdleThrottleSettings,
  localStorageIdleThrottleStorage,
} from "./io/idle-throttle-settings";
import { ensureRegistered, updateVoice } from "./io/irodori-voices";
import { createLipsyncSettings, localStorageLipsyncStorage } from "./io/lipsync-settings";
import { createProactiveSettings, localStorageProactiveStorage } from "./io/proactive-settings";
import { createScheduleSettings, localStorageScheduleStorage } from "./io/schedule-settings";
import { createScreenshotSettings, localStorageScreenshotStorage } from "./io/screenshot-settings";
import {
  createSessionDiagnosticsStore,
  localStorageSessionDiagnosticsStorage,
} from "./io/session-diagnostics";
import { createSessionStore, localStorageSessionStorage } from "./io/session-store";
import { createSettingsBridge } from "./io/settings-bridge";
import { wireStorageSync } from "./io/settings-window";
import {
  createSpeakerSelection,
  localStorageSpeakerStorage,
  localStorageUserSpeakerStorage,
  type SpeakerOption,
} from "./io/speaker-selection";
import { resolveScreenSourceProvider } from "./io/tauri-screen";
import { createVadSettings, localStorageVadStorage } from "./io/vad-settings";
import { importVoiceFromFile, removeUserVoice as removeUserVoiceFile } from "./io/voice-import";
import { importVrmFromFile, removeUserVrm } from "./io/vrm-import";
import {
  createVrmSelection,
  localStorageUserVrmStorage,
  localStorageVrmStorage,
} from "./io/vrm-selection";
import { createLogger, initLogger } from "./logger";
import { createQuickControls } from "./ui/quick-controls";
import { createVoiceInputStatus, type VoiceInputState } from "./ui/voice-input-status";

const log = createLogger("settings-bootstrap");

async function bootstrap(): Promise<void> {
  await initLogger();
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) {
    throw new Error("#app mount point not found");
  }

  const screenshotSettings = createScreenshotSettings({ storage: localStorageScreenshotStorage() });
  const idleThrottleSettings = createIdleThrottleSettings({
    storage: localStorageIdleThrottleStorage(),
  });
  const proactiveSettings = createProactiveSettings({ storage: localStorageProactiveStorage() });
  const scheduleSettings = createScheduleSettings({ storage: localStorageScheduleStorage() });
  const lipsyncSettings = createLipsyncSettings({ storage: localStorageLipsyncStorage() });
  const vadSettings = createVadSettings({ storage: localStorageVadStorage() });
  const fillerSettings = createFillerSettings({ storage: localStorageFillerStorage() });
  const agentSettings = createAgentSettings({ storage: localStorageAgentStorage() });
  const endpointsSettings = createEndpointsSettings({ storage: localStorageEndpointsStorage() });
  // 런타임 chat API 키 store(같은 localStorage 키). 이 창엔 SecretProvider가 없고(디스패처 없음),
  // 필드 표시 + cross-window 동기화만 담당한다.
  const chatKeySettings = createChatKeySettings({ storage: localStorageChatKeyStorage() });
  const voiceInputStatus = createVoiceInputStatus();
  const sourceProvider = resolveScreenSourceProvider();
  // 세션 포인터 + 진단. 펫 창이 localStorage에 쓰면 storage 이벤트로 이 창이 재로드한다.
  const sessionStore = createSessionStore(localStorageSessionStorage());
  const sessionDiagnostics = createSessionDiagnosticsStore(localStorageSessionDiagnosticsStorage());

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
    log.warn("config_load_failed", { error: String(err) });
  }

  // VRM 선택 store + 스왑. 이 창엔 렌더러가 없으므로 store-only 커밋.
  // 메인 창이 storage 재로드로 실제 VRM을 핫스왑한다.
  // fallback default로 만든 뒤, config가 로드됐으면 실제 available[]를 주입한다(메인 창과 동일).
  const vrmSelection = createVrmSelection({
    defaultUrl: "/vrms/carlotta.vrm",
    storage: localStorageVrmStorage(),
    userStorage: localStorageUserVrmStorage(),
  });
  if (configLoaded) {
    try {
      const avatar = config.get().avatar;
      vrmSelection.setManifest({ available: avatar.available, defaultUrl: avatar.vrm_url });
    } catch (err) {
      log.warn("avatar_config_read_failed", { fallback: true, error: String(err) });
    }
  }
  const swapVrm = async (option: { id: string }): Promise<void> => {
    vrmSelection.select(option.id);
  };
  // BYO-VRM 임포트(설정 창) — 렌더러가 없으므로 로드/메타는 펫 창에 맡긴다. 파일을 복사해
  // 파일명 stem 라벨로 옵션을 추가하고 선택만 한다. 펫 창이 cross-window로 실제 로드를 수행한다.
  // 취소(null)는 조용히 무시.
  const importVrm = async (): Promise<void> => {
    const option = await importVrmFromFile();
    if (option === null) return;
    vrmSelection.addUserOption(option);
    vrmSelection.select(option.id);
  };

  // irodori 화자 선택 store. 이 창엔 synth가 없으므로 store-only 커밋 — 등록은
  // 펫 창의 synth 경로가 다음 발화에서 수행한다(swapVrm가 select-only인 것과 동일).
  const speakerSelection = createSpeakerSelection({
    defaultId: "",
    storage: localStorageSpeakerStorage(),
    userStorage: localStorageUserSpeakerStorage(),
  });
  if (configLoaded) {
    try {
      const eps = config.get().endpoints;
      speakerSelection.setManifest({
        available: eps.irodori_voices,
        defaultId: eps.irodori_speaker ?? "",
      });
    } catch (err) {
      log.warn("irodori_config_read_failed", { fallback: true, error: String(err) });
    }
  }
  const swapSpeaker = async (option: SpeakerOption): Promise<void> => {
    speakerSelection.select(option.id);
  };
  // 참조 음성 재등록 — 펫 창과 달리 synth가 없지만, 갱신은 서버 직접 호출이므로 여기서도 수행한다.
  // config 미로드/irodori_base_url 없으면 throw → UI가 에러를 노출한다.
  const refreshSpeaker = async (option: SpeakerOption): Promise<void> => {
    const irodoriBaseUrl = configLoaded ? config.get().endpoints.irodori_base_url : undefined;
    if (!irodoriBaseUrl) throw new Error("irodori provider requires irodori_base_url");
    const f = await selectFetch();
    await updateVoice({ baseUrl: irodoriBaseUrl, id: option.id, refUrl: option.ref_url, fetch: f });
  };
  // BYO-voice 임포트(설정 창) — 등록은 서버 직접 호출이라 여기서도 수행한다(refreshSpeaker와 동일).
  // 파일 복사 → irodori 등록 → 옵션 추가 + 선택. 취소(null)는 무시. 등록 실패면 고아 사본 제거 후 throw.
  const importVoice = async (): Promise<void> => {
    const option = await importVoiceFromFile();
    if (option === null) return;
    try {
      const irodoriBaseUrl = configLoaded ? config.get().endpoints.irodori_base_url : undefined;
      if (!irodoriBaseUrl) throw new Error("irodori provider requires irodori_base_url");
      const f = await selectFetch();
      await ensureRegistered({
        baseUrl: irodoriBaseUrl,
        id: option.id,
        refUrl: option.ref_url,
        fetch: f,
      });
    } catch (err) {
      await removeUserVoiceFile(option.id).catch(() => {}); // 고아 사본 제거(best-effort)
      log.error("imported_voice_register_failed", { error: String(err) });
      throw err;
    }
    speakerSelection.addUserVoice(option);
    speakerSelection.select(option.id);
  };

  const quickControls = createQuickControls({
    mount: app,
    variant: "window",
    agentSettings,
    settings: screenshotSettings,
    idleThrottleSettings,
    proactiveSettings,
    scheduleSettings,
    sourceProvider,
    voiceStatus: voiceInputStatus,
    lipsync: lipsyncSettings,
    vad: vadSettings,
    fillerSettings,
    vrmSelection,
    swapVrm,
    importVrm,
    removeUserVrm,
    speakerSelection,
    swapSpeaker,
    refreshSpeaker,
    importVoice,
    removeUserVoice: removeUserVoiceFile,
    resolveAuditionUrl: (refUrl) => resolveAssetUrl(refUrl),
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
    endpointsSettings,
    chatKeySettings,
    getEndpointDefaults: () => {
      if (!configLoaded) return undefined;
      try {
        const e = config.get().endpoints;
        return {
          chat_base_url: e.chat_base_url,
          stt_base_url: e.stt_base_url,
          tts_base_url: e.tts_base_url,
          irodori_base_url: e.irodori_base_url ?? "",
          broker_base_url: e.broker_base_url ?? "",
          chat_model: e.chat_model ?? "",
          tts_provider: e.tts_provider ?? "",
        };
      } catch {
        return undefined;
      }
    },
    getDefaultProvider: () => {
      if (!configLoaded) return undefined;
      try {
        return config.get().endpoints.tts_provider;
      } catch {
        return undefined;
      }
    },
    sessionDiagnostics,
    sessionStore,
  });
  // window variant는 생성 시 자동으로 열리지만 멱등하므로 방어적으로 한 번 더 호출.
  quickControls.open();

  // 메인 창의 편집을 반영: cross-window storage 이벤트 + 포커스 폴백.
  // vrmSelection도 함께 재로드해 펫 창에서 바뀐 선택이 이 창 UI에 반영되게 한다.
  const resyncStores = [
    agentSettings,
    endpointsSettings,
    chatKeySettings,
    lipsyncSettings,
    vadSettings,
    fillerSettings,
    screenshotSettings,
    idleThrottleSettings,
    proactiveSettings,
    scheduleSettings,
    vrmSelection,
    speakerSelection,
    sessionStore,
    sessionDiagnostics,
  ];
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
  endpointsSettings.subscribe(broadcastSettings);
  chatKeySettings.subscribe(broadcastSettings);
  lipsyncSettings.subscribe(broadcastSettings);
  vadSettings.subscribe(broadcastSettings);
  fillerSettings.subscribe(broadcastSettings);
  screenshotSettings.subscribe(broadcastSettings);
  idleThrottleSettings.subscribe(broadcastSettings);
  proactiveSettings.subscribe(broadcastSettings);
  scheduleSettings.subscribe(broadcastSettings);
  // VRM 선택도 cross-window로 알린다 → 펫 창이 받아 렌더러를 핫스왑한다(Tauri storage 이벤트 불안정 대비).
  vrmSelection.subscribe(broadcastSettings);
  // 화자 선택도 cross-window로 알린다 → 펫 창이 받아 다음 발화에서 새 화자로 합성한다.
  speakerSelection.subscribe(broadcastSettings);
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
