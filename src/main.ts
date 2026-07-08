/**
 * YUI bootstrap.
 *
 * 그래프:
 *   loadConfig() → createRenderer(mount) → createTier1Engine(renderer)
 *               → createEventBus() + createGuardrails()
 *               → createDispatcher({ bus, guardrails, renderer })
 *               → sources(timer/idle/user_input + Rust os_event) 구독 → dispatcher.start()
 *   io: streamChat(SSE) → express + 텍스트 스트림 → renderer / surfaces / tts-pipeline.
 *
 *   - .yui-stage: 투명 캐릭터 무대(드래그 영역). renderer가 캔버스로 채운다.
 *   - .yui-ui:    오버레이 — 발화 말풍선·툴상태·텍스트 입력(invisible-by-default).
 */

import "./styles.css";
import { createTier1Engine } from "./ambient/tier1";
import { wireSpeakerSelection, wireVrmSelection } from "./bootstrap-wiring";
import {
  CHAT_API_KEY_SECRET,
  createConfigStore,
  loadEmotionTextTable,
  STT_API_KEY_SECRET,
  TTS_API_KEY_SECRET,
} from "./config";
import type { WindowRect } from "./contract";
import { createAgentSource } from "./dispatcher/agent-source";
import { createBackendCaller } from "./dispatcher/backend-caller";
import { createDispatcher, type Dispatcher } from "./dispatcher/dispatcher";
import { createEventBus } from "./dispatcher/event-bus";
import { createGithubSource, type LastSeenMap } from "./dispatcher/github-source";
import { createGuardrails, type Guardrails } from "./dispatcher/guardrails";
import { createProactiveSource } from "./dispatcher/proactive-source";
import { createScheduleSource } from "./dispatcher/schedule-source";
import { createUserInputSource } from "./dispatcher/user-input-source";
import { initDrag } from "./drag";
import {
  createAgentNotifySettings,
  localStorageAgentNotifyStorage,
} from "./io/agent-notify-settings";
import { createAgentSettings, localStorageAgentStorage } from "./io/agent-settings";
import { createSttKeySettings, createTtsKeySettings } from "./io/api-key-settings";
import { resolveAssetUrl } from "./io/asset-url";
import { createWebAudioSink } from "./io/audio-player";
import { type BrokerClient, createBrokerClient, deriveBrokerPayload } from "./io/broker-client";
import { createBrokerOverrideReconciler } from "./io/broker-override-reconciler";
import {
  CAMERA_ORBIT_SENSITIVITY,
  CAMERA_WHEEL_SENSITIVITY,
  CAMERA_ZOOM_MAX,
  CAMERA_ZOOM_MIN,
  createCameraSettings,
  localStorageCameraStorage,
} from "./io/camera-settings";
import { selectFetch } from "./io/chat-client";
import { createChatHistoryStore, localStorageChatHistoryStorage } from "./io/chat-history-store";
import { createChatKeySettings, localStorageChatKeyStorage } from "./io/chat-key-settings";
import {
  createEndpointsSettings,
  localStorageEndpointsStorage,
  mergeEndpoints,
} from "./io/endpoints-settings";
import { createFillerLoop } from "./io/filler-loop";
import { effectiveFillerPool } from "./io/filler-pool";
import { createFillerSettings, localStorageFillerStorage } from "./io/filler-settings";
import { createGazeSettings, localStorageGazeStorage } from "./io/gaze-settings";
import { githubQuery } from "./io/github-query";
import { createGithubSettings, localStorageGithubStorage } from "./io/github-settings";
import { createHitTestController, type HitTestController } from "./io/hit-test";
import {
  createIdleThrottleSettings,
  localStorageIdleThrottleStorage,
} from "./io/idle-throttle-settings";
import { createIrodoriSynth, type TtsSynth } from "./io/irodori-synth";
import { createIrodoriSynthFactory } from "./io/irodori-synth-factory";
import { ensureRegistered, evictRegistration } from "./io/irodori-voices";
import { createLipsyncSettings, localStorageLipsyncStorage } from "./io/lipsync-settings";
import { createOsContext } from "./io/os-context";
import { localStorageStore } from "./io/persisted-store";
import { createPresenceSettings, localStoragePresenceStorage } from "./io/presence-settings";
import { createProactiveSettings, localStorageProactiveStorage } from "./io/proactive-settings";
import { createScheduleSettings, localStorageScheduleStorage } from "./io/schedule-settings";
import { buildScreenshotBlock } from "./io/screenshot-context";
import { createScreenshotSettings, localStorageScreenshotStorage } from "./io/screenshot-settings";
import { createSettingsSecretProvider } from "./io/secret-provider";
import {
  createSessionDiagnosticsStore,
  localStorageSessionDiagnosticsStorage,
} from "./io/session-diagnostics";
import { createSessionStore, localStorageSessionStorage } from "./io/session-store";
import { createSettingsBridge } from "./io/settings-bridge";
import { createSettingsWindowOpener, wireStorageSync } from "./io/settings-window";
import { createSpeechPlayback } from "./io/speech-playback";
import { createSttSettings, localStorageSttStorage } from "./io/stt-settings";
import type { SttVad } from "./io/stt-vad";
import { createSummonHotkey, type SummonHotkey } from "./io/summon-hotkey";
import { resolveScreenCapturer, resolveScreenSourceProvider } from "./io/tauri-screen";
import { TTS_SKIP } from "./io/tts-pipeline";
import { createTtsSettings, localStorageTtsStorage } from "./io/tts-settings";
import { createTtsSynth } from "./io/tts-synth";
import { createVadSettings, localStorageVadStorage } from "./io/vad-settings";
import { removeUserVoice as removeUserVoiceFile } from "./io/voice-import";
import { removeUserVrm } from "./io/vrm-import";
import { createWindowDropSource } from "./io/window-drop-source";
import { createWindowResizeSource } from "./io/window-resize-source";
import { createLogger, initLogger } from "./logger";
import { createRenderer } from "./renderer";
import { nextZoom } from "./renderer/camera-fit";
import {
  INPUT_ANCHOR_EPSILON_PX,
  INPUT_ANCHOR_MIN_BOTTOM_PX,
  INPUT_FEET_GAP_PX,
  inputBottomFromAnchor,
} from "./ui/anchor";
import { createCaptureIndicator } from "./ui/capture-indicator";
import {
  reloadFromStorage as reloadLocaleFromStorage,
  subscribe as subscribeLocale,
} from "./ui/i18n";
import { createMockDriver } from "./ui/mock";
import { createQuickControls } from "./ui/quick-controls";
import { createSurfaces } from "./ui/surfaces";
import { routeTurnFailure, turnErrorMessage } from "./ui/turn-error";
import { createVoiceInputIndicator } from "./ui/voice-input-indicator";
import { createVoiceInputStatus } from "./ui/voice-input-status";

/** 입력 소환 핫키 (window-focus 한정 — 전역 단축키는 후속 tauri-plugin-global-shortcut). */
const SUMMON_KEY = "/";

/** voice-input-indicator의 backend-turn-failure "error" 표시 유지 시간(ms) — 이후 listening으로 복귀. */
const VOICE_TURN_ERROR_DISPLAY_MS = 3_000;

const log = createLogger("bootstrap");

async function bootstrap(): Promise<void> {
  await initLogger();
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) {
    throw new Error("#app mount point not found");
  }

  // 루트(포지셔닝 컨텍스트) > 무대(드래그) + 오버레이(surfaces).
  // 무대 = 드래그, 오버레이 = pointer 통과(입력만 예외).
  // Drag is handled via initDrag — gesture-stub seam allows per-region filtering.
  app.innerHTML = `
    <div class="yui-root">
      <div class="yui-stage"></div>
    </div>
  `;
  const root = app.querySelector<HTMLDivElement>(".yui-root")!;
  const stage = root.querySelector<HTMLDivElement>(".yui-stage")!;

  // Drag: a primary press that crosses the move threshold → OS-native drag via
  // Tauri IPC + a tier1 user.drag_start onto the bus (plays the drag motion,
  // clears any stale perch). onScaleChanged listener installed inside for DPI seam.
  // Click-through hit-test controller — late-bound (created after config load so
  // it gets the hit_test knob). Drag suspends toggling so the OS-native drag is
  // never interrupted by a mid-gesture ignore flip.
  let hitTestRef: HitTestController | null = null;
  const cleanupDrag = await initDrag(stage, {
    onDragStart: () => {
      hitTestRef?.suspend();
      bus.push({
        source: "os_event_watcher",
        event_name: "user.drag_start",
        ts: Date.now(),
        hint_tier: 1,
        dnd_override: true,
      });
    },
    onDragEnd: () => hitTestRef?.resume(),
    onOrbitStart: () => hitTestRef?.suspend(),
    onOrbitEnd: () => hitTestRef?.resume(),
    // Shift + left-drag orbits the camera. dx → azimuth, dy → polar; clamp/persist
    // live in cameraSettings, which drives renderer.setOrbit via the subscription below.
    onOrbit: ({ dx, dy }) => {
      const cur = cameraSettings.get();
      cameraSettings.setAzimuth(cur.azimuth + dx * CAMERA_ORBIT_SENSITIVITY);
      cameraSettings.setPolar(cur.polar - dy * CAMERA_ORBIT_SENSITIVITY);
    },
  });

  // 마우스 휠로 캐릭터 스케일: 클램프 경계·민감도는 io 상수, persist는 store가 소유.
  // 드래그는 pointerdown만 쓰므로 wheel과 충돌하지 않는다(drag.ts).
  const onWheelZoom = (e: WheelEvent): void => {
    if (e.ctrlKey) return; // ctrl+wheel은 창 리사이즈 제스처 (window-resize-source).
    e.preventDefault();
    const next = nextZoom(cameraSettings.get().zoom, e.deltaY, {
      min: CAMERA_ZOOM_MIN,
      max: CAMERA_ZOOM_MAX,
      sensitivity: CAMERA_WHEEL_SENSITIVITY,
    });
    cameraSettings.setZoom(next);
  };
  stage.addEventListener("wheel", onWheelZoom, { passive: false });

  // Register drag + wheel cleanup on HMR dispose in dev.
  if (import.meta.env.DEV) {
    import.meta.hot?.dispose(() => {
      cleanupDrag();
      stage.removeEventListener("wheel", onWheelZoom);
    });
  }

  const renderer = createRenderer({ mount: stage });
  // Tier 1 ambient: backend 독립, 항상 ON. tick은 vrm 로드 후부터 발화하므로
  // loadVRM 전에 start해도 안전 (vrm 없는 프레임은 no-op).
  const ambient = createTier1Engine(renderer);
  ambient.start();
  const surfaces = createSurfaces({ mount: root });
  const mock = createMockDriver(surfaces);

  // 채팅 입력을 캐릭터 발밑에 붙인다(reframe 추종). 매 프레임 발밑 화면좌표를 받아
  // 입력 하단 오프셋으로 매핑하되, epsilon 이하 변화는 건너뛰어 var 재기록을 줄인다.
  let lastInputBottom: number | null = null;
  const unsubAnchor = renderer.onTick(() => {
    const a = renderer.getCharacterAnchor();
    if (!a) {
      if (lastInputBottom !== null) {
        surfaces.setInputAnchor(null);
        lastInputBottom = null;
      }
      return;
    }
    const bottom = inputBottomFromAnchor(a.y, stage.clientHeight || 1, {
      gap: INPUT_FEET_GAP_PX,
      minBottom: INPUT_ANCHOR_MIN_BOTTOM_PX,
    });
    if (lastInputBottom === null || Math.abs(bottom - lastInputBottom) > INPUT_ANCHOR_EPSILON_PX) {
      surfaces.setInputAnchor(bottom);
      lastInputBottom = bottom;
    }
  });

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
  // GitHub PR 워처 on/off + 폴 주기 설정. 소스 firing만 게이팅 — 폴 루프는 멈추지 않는다.
  const githubSettings = createGithubSettings({
    storage: localStorageGithubStorage(),
  });
  // Agent completion 알림 on/off + 수신 포트. 소스 firing만 게이팅.
  const agentNotifySettings = createAgentNotifySettings({
    storage: localStorageAgentNotifyStorage(),
  });
  // Presence window threshold — "present when idle ≤ N ms". Shared by proactive/github/agent sources.
  const presenceSettings = createPresenceSettings({ storage: localStoragePresenceStorage() });
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
  // config.endpoints 위에 오버라이드를 얹은 effective 엔드포인트. 호출 시점에 평가(핫리로드 친화).
  function getEndpoints(): ReturnType<typeof config.get>["endpoints"] {
    return mergeEndpoints(config.get().endpoints, endpointsSettings.get());
  }
  // 카메라 줌: persist된 배율을 부트 시 적용하고, 변경(휠/크로스윈도우)마다 렌더러로 흘린다.
  const cameraSettings = createCameraSettings({
    storage: localStorageCameraStorage(),
  });
  renderer.setZoom(cameraSettings.get().zoom);
  renderer.setOrbit({ azimuth: cameraSettings.get().azimuth, polar: cameraSettings.get().polar });
  cameraSettings.subscribe((s) => {
    renderer.setZoom(s.zoom);
    renderer.setOrbit({ azimuth: s.azimuth, polar: s.polar });
  });
  renderer.setIdleThrottleEnabled(idleThrottleSettings.get().enabled);
  idleThrottleSettings.subscribe((s) => renderer.setIdleThrottleEnabled(s.enabled));
  // 카메라 시선 맞춤(gaze) on/off. 기본 ON. 변경(토글/크로스윈도우)마다 렌더러로 흘린다.
  const gazeSettings = createGazeSettings({ storage: localStorageGazeStorage() });
  renderer.setGazeEnabled(gazeSettings.get().enabled);
  gazeSettings.subscribe((s) => renderer.setGazeEnabled(s.enabled));
  const voiceInputStatus = createVoiceInputStatus();
  const screenSourceProvider = resolveScreenSourceProvider();
  const screenCapturer = resolveScreenCapturer();
  // foreground app/title 스냅샷 — backend_caller가 매 요청에 env로 첨부. non-Tauri면 no-op.
  const osContext = createOsContext();
  void osContext.start();
  // 팝아웃: Tauri면 별도 WebviewWindow("settings"), 아니면 브라우저 창. 메인 창 편집을
  // 거기서, 거기 편집을 여기서 반영하도록 wireStorageSync로 storage 이벤트를 양방향 연결한다.
  const openSettings = createSettingsWindowOpener();
  const disposeStorageSync = wireStorageSync([
    agentSettings,
    endpointsSettings,
    chatKeySettings,
    sttKeySettings,
    ttsKeySettings,
    lipsyncSettings,
    vadSettings,
    fillerSettings,
    screenshotSettings,
    proactiveSettings,
    idleThrottleSettings,
    gazeSettings,
    ttsSettings,
    cameraSettings,
    sessionStore,
    sessionDiagnostics,
    chatHistoryStore,
  ]);

  // 팝아웃 설정 창과의 실시간 배선(Tauri 이벤트). 별도 창의 컨트롤이 이 창의 살아있는
  // 시스템(VRM 렌더러 · STT/VAD)에 닿게 한다. storage 폴백은 위 wireStorageSync로 유지.
  const bridge = createSettingsBridge();
  // 입 프리뷰(별도 창 → 이 창 VRM): 게인 슬라이더 드래그가 실제 입을 움직이게.
  bridge.onMouthPreview((mouthOpen) => {
    if (mouthOpen == null) renderer.stopMouth();
    else renderer.setMouthOpen(mouthOpen);
  });
  // 음성 토글(별도 창 → 이 창 STT): 기존 voiceInputStatus 구독이 sttVad를 시작/정지한다.
  bridge.onVoiceSet((on) => {
    log.info("voice_toggle_received", { on, source: "settings_window" });
    voiceInputStatus.set(on ? "listening" : "idle");
  });
  // 음성 상태(이 창 → 별도 창): 별도 창 indicator가 실제 STT 상태를 반영하게.
  voiceInputStatus.subscribe((snapshot) => {
    bridge.emitVoiceState({ state: snapshot.state, detail: snapshot.detail });
  });
  // 음성입력 on/off 의도를 영속화 — idle이 아니면 켜짐. 다음 실행에서 자동 재개에 쓴다.
  const unsubscribeSttPersist = voiceInputStatus.subscribe((snapshot) => {
    sttSettings.setEnabled(snapshot.state !== "idle");
  });
  // 설정 동기화(양방향, 루프 가드): 한쪽 편집 → emit → 다른쪽 store 재로드.
  // store는 값이 그대로면 no-op이므로 왕복이 종료된다.
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
  // 동일하게 broadcast/reload 되는 설정 store들. cameraSettings는 reload가
  // 줌까지 전파되어 별도 주석으로 남기므로 배열에서 제외한다.
  type SyncedStore = {
    subscribe(cb: () => void): () => void;
    reloadFromStorage(): void;
  };
  const syncedSettingsStores: SyncedStore[] = [
    agentSettings,
    endpointsSettings,
    chatKeySettings,
    sttKeySettings,
    ttsKeySettings,
    lipsyncSettings,
    vadSettings,
    fillerSettings,
    screenshotSettings,
    proactiveSettings,
    scheduleSettings,
    githubSettings,
    agentNotifySettings,
    presenceSettings,
    idleThrottleSettings,
    ttsSettings,
  ];
  for (const store of syncedSettingsStores) store.subscribe(broadcastSettings);
  cameraSettings.subscribe(broadcastSettings);
  // 표시 언어도 창 간 동기화: 변경을 브로드캐스트하고, 원격 변경 시 storage에서 재적용한다.
  subscribeLocale(broadcastSettings);
  bridge.onSettingsChanged(() => {
    applyingRemote = true;
    try {
      for (const store of syncedSettingsStores) store.reloadFromStorage();
      // 줌 재로드 → cameraSettings.subscribe(s => renderer.setZoom)가 카메라까지 반영.
      cameraSettings.reloadFromStorage();
      // 다른 창에서 바뀐 표시 언어 반영 → i18n.subscribe 재마운트 구독자가 UI를 다시 그린다.
      reloadLocaleFromStorage();
      // VRM 선택은 설정 창에서 store-only로 커밋되므로, 그 변경을 펫 창 렌더러로 반영.
      // 이 창 자체 스왑은 swapVrm이 이미 로드하므로, 여기선 OTHER 창 변경만 → 이중 로드 회피.
      const prevVrmUrl = vrmSelection.getActive().url;
      vrmSelection.reloadFromStorage();
      const nextVrmUrl = vrmSelection.getActive().url;
      if (nextVrmUrl !== prevVrmUrl) {
        void loadVrmSerialized(nextVrmUrl).catch((err) =>
          log.error("vrm_cross_window_swap_failed", { error: String(err) }),
        );
      }
      // 화자 선택은 store-only — synth가 다음 발화에서 getActive()로 읽으므로 재로드만 한다.
      speakerSelection.reloadFromStorage();
    } finally {
      applyingRemote = false;
    }
    log.info("settings_change_received", { source: "settings_window" });
  });
  const { vrmSelection, loadVrmSerialized, swapVrm, importVrm } = wireVrmSelection({
    renderer,
    log,
    broadcastSettings,
  });

  const { speakerSelection, swapSpeaker, refreshSpeaker, importVoice } = wireSpeakerSelection({
    getEndpoints,
    log,
    broadcastSettings,
  });

  const buildQuickControls = (): ReturnType<typeof createQuickControls> =>
    createQuickControls({
      mount: root,
      settings: screenshotSettings,
      idleThrottleSettings,
      gazeSettings,
      proactiveSettings,
      scheduleSettings,
      githubSettings,
      agentNotifySettings,
      presenceSettings,
      sourceProvider: screenSourceProvider,
      voiceStatus: voiceInputStatus,
      lipsync: lipsyncSettings,
      vad: vadSettings,
      fillerSettings,
      ttsSettings,
      agentSettings,
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
      onGainPreview: (mouthOpen) => renderer.setMouthOpen(mouthOpen),
      onGainPreviewEnd: () => renderer.stopMouth(),
      // Reset the camera viewpoint to head-on (store drives renderer.setOrbit).
      onResetViewpoint: () => cameraSettings.resetOrbit(),
      // 빈 instructions일 때 placeholder로 보여줄 기본 지침(config 미로드 시 무시).
      getDefaultInstructions: () => {
        try {
          return getEndpoints().chat_instructions;
        } catch {
          return undefined;
        }
      },
      endpointsSettings,
      chatKeySettings,
      sttKeySettings,
      ttsKeySettings,
      getEndpointDefaults: () => {
        try {
          const e = config.get().endpoints;
          return {
            chat_base_url: e.chat_base_url,
            stt_base_url: e.stt_base_url,
            tts_base_url: e.tts_base_url,
            irodori_base_url: e.irodori_base_url ?? "",
            broker_base_url: e.broker_base_url ?? "",
            chat_model: e.chat_model ?? "",
            chat_api: e.chat_api ?? "",
            tts_voice: e.tts_voice ?? "",
            tts_provider: e.tts_provider ?? "",
          };
        } catch {
          return undefined;
        }
      },
      getDefaultProvider: () => {
        try {
          return config.get().endpoints.tts_provider;
        } catch {
          return undefined;
        }
      },
      getDefaultChatApi: () => {
        try {
          return config.get().endpoints.chat_api;
        } catch {
          return undefined;
        }
      },
      onPopOut: () => openSettings(),
    });
  // DOM surfaces re-mounted on locale change (see i18n subscriber below). Held in
  // let bindings; onActivate arrows read the live binding, so recreating is safe.
  let quickControls = buildQuickControls();
  const buildCaptureIndicator = (): ReturnType<typeof createCaptureIndicator> =>
    createCaptureIndicator({
      mount: root,
      settings: screenshotSettings,
      onActivate: () => quickControls.open(),
    });
  const buildVoiceInputIndicator = (): ReturnType<typeof createVoiceInputIndicator> =>
    createVoiceInputIndicator({
      mount: root,
      status: voiceInputStatus,
      onActivate: () => quickControls.open(),
    });
  let captureIndicator = buildCaptureIndicator();
  let voiceInputIndicator = buildVoiceInputIndicator();

  // Re-mount the localized DOM surfaces when the display language changes.
  // Deferred to a microtask so the triggering click handler (the picker lives
  // inside quick-controls) unwinds before its host is disposed. Long-lived
  // non-UI singletons (renderer, TTS pipeline, VAD, voiceStatus store) and the
  // dispatcher-wired `surfaces` instance are intentionally NOT re-created here.
  const unsubscribeLocale = subscribeLocale(() => {
    queueMicrotask(() => {
      voiceInputIndicator.dispose();
      captureIndicator.dispose();
      quickControls.dispose();
      quickControls = buildQuickControls();
      captureIndicator = buildCaptureIndicator();
      voiceInputIndicator = buildVoiceInputIndicator();
    });
  });

  function onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    quickControls.open({ x: e.clientX, y: e.clientY });
  }
  stage.addEventListener("contextmenu", onContextMenu);

  if (import.meta.env.DEV) {
    import.meta.hot?.dispose(() => {
      unsubAnchor();
      unsubscribeLocale();
      quickControls.dispose();
      if (broadcastTimer) clearTimeout(broadcastTimer);
      bridge.dispose();
      disposeStorageSync();
      captureIndicator.dispose();
      voiceInputIndicator.dispose();
      unsubscribeVoiceInputStatus();
      unsubscribeSttPersist();
      void sttVad?.dispose();
      voiceInputStatus.dispose();
      screenshotSettings.dispose();
      idleThrottleSettings.dispose();
      gazeSettings.dispose();
      ttsSettings.dispose();
      sttSettings.dispose();
      proactiveSettings.dispose();
      scheduleSettings.dispose();
      githubSettings.dispose();
      agentNotifySettings.dispose();
      presenceSettings.dispose();
      lipsyncSettings.dispose();
      vadSettings.dispose();
      fillerSettings.dispose();
      agentSettings.dispose();
      endpointsSettings.dispose();
      chatKeySettings.dispose();
      sttKeySettings.dispose();
      ttsKeySettings.dispose();
      cameraSettings.dispose();
      vrmSelection.dispose();
      speakerSelection.dispose();
      osContext.stop();
      windowDropDisposed = true;
      windowDropSource?.stop();
      windowResizeSource?.stop();
      stage.removeEventListener("contextmenu", onContextMenu);
    });
  }

  // ── Dispatcher spine ──────────────────────────────────────────────────────
  // event_bus → dispatcher → backend_caller → streamChat → Hermes → ControlEnvelope →
  // renderer.applyDirective. user.text_submitted가 이 루프를 구동한다.
  // bus/dispatcher는 config 로드 전에 만들어도 안전(엔드포인트는 backend_caller가 호출 시점에
  // config에서 읽는다). 다만 backend_caller는 config 스토어가 필요하므로 config 생성 후 배선한다.
  const bus = createEventBus({
    onDrop: (env, reason) => log.info("drop", { event_name: env.event_name, reason }),
  });
  const userInput = createUserInputSource(bus);
  // Window-sit drop producer: Rust window_drop_release → tier1 perch event.
  // Tauri-only — getCurrentWindow()/invoke/listen require the Tauri runtime; in a
  // plain browser (Vite dev) it is skipped so bootstrap still runs. The DEV mock
  // (__yui_windowSit.drop) exercises the geometry path without a real drag.
  let windowDropSource: ReturnType<typeof createWindowDropSource> | null = null;
  // Ctrl+wheel pet-window resize producer (Tauri-only, same lifecycle as above).
  let windowResizeSource: ReturnType<typeof createWindowResizeSource> | null = null;
  // Guards the teardown/async-assign race: cleanup may run before the IIFE assigns.
  let windowDropDisposed = false;
  if ((globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    void (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      // Only bind the loopback ingress when the watcher is on. Restart-to-apply:
      // toggling enable/port takes effect on next launch (no live rebind).
      if (agentNotifySettings.get().enabled) {
        void invoke("start_agent_ingress", { port: agentNotifySettings.get().port }).catch((e) =>
          log.warn("start_agent_ingress_failed", { error: String(e) }),
        );
      }
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const { listen } = await import("@tauri-apps/api/event");
      windowDropSource = createWindowDropSource({
        bus,
        renderer,
        invoke: (cmd) => invoke(cmd) as Promise<WindowRect[]>,
        getWindow: getCurrentWindow,
        listen: listen as never,
      });
      const { LogicalPosition, LogicalSize } = await import("@tauri-apps/api/dpi");
      windowResizeSource = createWindowResizeSource({
        renderer,
        getWindow: () => {
          const win = getCurrentWindow();
          return {
            outerPosition: () => win.outerPosition(),
            outerSize: () => win.outerSize(),
            scaleFactor: () => win.scaleFactor(),
            async setBoundsLogical(pos, size) {
              await win.setSize(new LogicalSize(size.width, size.height));
              await win.setPosition(new LogicalPosition(pos.x, pos.y));
            },
          };
        },
      });
      if (windowDropDisposed) {
        windowDropSource.stop();
        return;
      }
      await windowDropSource.start();
      windowResizeSource.start();
    })().catch((err) =>
      log.warn("window_drop_source_start_failed", {
        degrade: true,
        error: String(err),
      }),
    );
  }
  let sttVad: SttVad | null = null;
  let voiceInputReady = false;
  let voiceInputStartRequested = false;

  async function startVoiceInput(): Promise<void> {
    voiceInputStartRequested = true;
    if (!voiceInputReady || !sttVad) return;
    try {
      await sttVad.start();
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Voice input failed";
      voiceInputStatus.set("error", detail);
    }
  }

  function stopVoiceInput(): void {
    voiceInputStartRequested = false;
    sttVad?.stop();
  }

  const unsubscribeVoiceInputStatus = voiceInputStatus.subscribe((snapshot) => {
    if (snapshot.state === "idle") {
      stopVoiceInput();
      return;
    }
    if (snapshot.state === "listening") {
      void startVoiceInput();
    }
  });
  // dispatcher는 config 로드 후 생성되므로(backend_caller가 config.get()에 의존), dev 인스펙션
  // 핸들이 참조할 수 있게 forward holder를 둔다.
  let dispatcherRef: Dispatcher | null = null;
  // voice-turn 실패 error 표시(~3s) 되돌리기 타이머 — 겹친 실패가 이전 타이머를 남겨 더 늦은
  // 표시를 일찍 끊지 않도록 재무장 전 항상 clearTimeout한다(dwellTimer/broadcastTimer와 동일 패턴).
  let voiceTurnErrorTimer: ReturnType<typeof setTimeout> | null = null;
  // 발화 후보 소스 holder — teardown에서 stop하도록 둔다.
  let proactiveSourceRef: {
    stop(): void;
    noteInteraction(ts?: number): void;
  } | null = null;
  let scheduleSourceRef: { stop(): void } | null = null;
  let githubSourceRef: { stop(): void } | null = null;
  let agentSourceRef: { stop(): void } | null = null;
  // guardrails도 config 로드 후 생성 — 핫리로드 setConfig가 닿게 holder를 둔다.
  let guardrailsRef: Guardrails | null = null;
  // broker client는 config 로드 후 broker_base_url이 있을 때만 만든다. 핫스왑 재publish와
  // HMR dispose가 닿게 holder를 둔다.
  let brokerRef: BrokerClient | null = null;
  // 전역 소환 핫키(Tauri 전용) — 핫리로드 재적용이 닿게 holder를 둔다.
  let summonHotkeyRef: SummonHotkey | null = null;
  // Tauri webview에서 broker(localhost:3201)는 cross-origin → selectFetch로 CORS 우회 fetch 주입.
  // 부트에서 1회 해소해 캐시하고, 재지정(override) 시에도 같은 fetch를 재사용한다.
  let brokerFetch: typeof fetch | undefined;
  function makeBroker(baseUrl: string): BrokerClient {
    return createBrokerClient({
      baseUrl,
      ...(brokerFetch ? { fetch: brokerFetch } : {}),
    });
  }

  // irodori provider일 때만 enum 테이블을 best-effort 로드. 실패하면 warn 후 null →
  // broker가 free 모드로 degrade(D4). 부트/핫스왑을 막지 않는다.
  async function loadBrokerTable(
    provider: string | undefined,
  ): Promise<Record<string, string> | null> {
    if (provider !== "irodori") return null;
    try {
      return await loadEmotionTextTable({ provider: "irodori" });
    } catch (err) {
      log.warn("emotion_text_load_failed", {
        fallback: "free",
        error: String(err),
      });
      return null;
    }
  }

  // 제출 → dispatcher 스파인으로 발사(user.text_submitted). 입력은 열어 둔 채 send→stop로
  // 전환(subscribeBusy)되고, 턴 완료 시 send로 복귀한다. mock은 dev 데모 전용으로 유지.
  surfaces.onSubmit((text, images) => {
    userInput.submit(text, images);
    // YUI와 대화 → 주도적 반응의 무대화 경과 타이머 리셋.
    proactiveSourceRef?.noteInteraction();
  });

  // 핫키: window 포커스 상태에서 SUMMON_KEY로 입력 소환. (Esc/Enter는 입력 내부에서 처리)
  function onKeydown(e: KeyboardEvent): void {
    if (e.key !== SUMMON_KEY || e.metaKey || e.ctrlKey || e.altKey) return;
    if (surfaces.isInputOpen()) return;
    if (isTypingTarget(e.target)) return;
    e.preventDefault();
    surfaces.summonInput();
  }
  window.addEventListener("keydown", onKeydown);

  // dev 전용: 스크린샷 검증 루프에서 직접 호출할 핸들.
  if (import.meta.env.DEV) {
    Object.assign(globalThis as Record<string, unknown>, {
      __yuiRenderer: renderer,
      __yuiAmbient: ambient,
      __yuiSurfaces: surfaces,
      __yuiMock: mock,
      __yuiScreenshot: screenshotSettings,
      __yuiLipsync: lipsyncSettings,
      __yuiAgent: agentSettings,
      __yuiQuick: quickControls,
      __yuiVoiceInputStatus: voiceInputStatus,
      // DEV-ONLY 트리거: E2E 루프를 콘솔에서 직접 발사한다.
      //   window.__yui_send("안녕") → user.text_submitted → dispatcher → backend_caller →
      //   streamChat → Hermes → ControlEnvelope → renderer.applyDirective + 말풍선.
      // 검증용 임시 핸들.
      __yui_send: (text: string) => userInput.submit(text),
      // dispatcher 관찰: __yui_dispatcher.inFlight()/queue()/recentDrops().
      __yui_dispatcher: () => dispatcherRef,
      // DEV-ONLY 트리거: window_sit perch 진입/이탈/드롭을 콘솔에서 직접 발사한다.
      //   window.__yui_windowSit.enter() → user.window_sit_enter → dispatcher → renderer.
      //   window.__yui_windowSit.drop(rect) → user.window_sit_drop(geometry) → perch align.
      __yui_windowSit: {
        enter: () =>
          bus.push({
            source: "user_input_source",
            event_name: "user.window_sit_enter",
            ts: Date.now(),
            hint_tier: 1,
            dnd_override: true,
          }),
        exit: () =>
          bus.push({
            source: "user_input_source",
            event_name: "user.window_sit_exit",
            ts: Date.now(),
            hint_tier: 1,
            dnd_override: true,
          }),
        // edge_local_ypx를 현재 창 outerPosition/scaleFactor로 계산해 geometry 경로를
        // 실제 OS 창 없이 구동한다(Tauri면 실값, 아니면 0,0/1 폴백).
        drop: async (rect: WindowRect): Promise<void> => {
          let pos = { x: 0, y: 0 };
          let scale = 1;
          if ((globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
            try {
              const { getCurrentWindow } = await import("@tauri-apps/api/window");
              const w = getCurrentWindow();
              pos = await w.outerPosition();
              scale = await w.scaleFactor();
            } catch {
              /* fallback to 0,0 / 1 */
            }
          }
          const sf = scale > 0 ? scale : 1;
          bus.push({
            source: "os_event_watcher",
            event_name: "user.window_sit_drop",
            ts: Date.now(),
            hint_tier: 1,
            dnd_override: true,
            payload: {
              target_window_rect: rect,
              edge_local_ypx: rect.y - pos.y / sf,
            },
          });
        },
        // 점유 시뮬레이션: 실제 두 번째 창 없이 occlusion poll의 이탈 결과(window_sit_exit)를 발사한다.
        occlude: (_rect?: WindowRect) =>
          bus.push({
            source: "os_event_watcher",
            event_name: "user.window_sit_exit",
            ts: Date.now(),
            hint_tier: 1,
            dnd_override: true,
          }),
      },
      // 단계별 시연 헬퍼
      __yuiDemo: {
        input: () => surfaces.summonInput(),
        tool: (label = "검색 중…") => surfaces.showTool(label),
        send: (text = "안녕") => userInput.submit(text),
        reply: (text = "오늘 일정 뭐 있어?") => mock.reply(text),
        proactive: () => mock.proactive(),
        speak: (line = "응, 듣고 있어. 그거 지금 같이 볼까?") => mock.speak(line),
        tap: () => ambient.trigger("tap_react"),
        idleReturn: () => ambient.trigger("idle_returned"),
      },
    });
  }

  // config-driven 로드: configs/*.json → 검증된 AppConfig. endpoints/motions 등은
  // dispatcher·tts 배선 시 소비. avatar.vrm_url로 VRM을 띄운다.
  // chat 키는 SecretProvider로 주입 — dev는 Vite env, prod/OSS는 keychain 구현으로 교체.
  // dispatcher가 streamChat 호출 시 `await config.secrets.get(CHAT_API_KEY_SECRET)`로 해소한다.
  const config = createConfigStore({
    secrets: createSettingsSecretProvider({
      stores: {
        [CHAT_API_KEY_SECRET]: chatKeySettings,
        [STT_API_KEY_SECRET]: sttKeySettings,
        [TTS_API_KEY_SECRET]: ttsKeySettings,
      },
      fallback: {
        [CHAT_API_KEY_SECRET]: import.meta.env.VITE_YUI_CHAT_KEY,
        [STT_API_KEY_SECRET]: import.meta.env.VITE_YUI_STT_KEY,
        [TTS_API_KEY_SECRET]: import.meta.env.VITE_YUI_TTS_KEY,
      },
    }),
  });
  // dev에서 런타임 오버라이드도 build-time 키도 없으면 chat 호출이 조용한 401처럼 보인다 →
  // bootstrap에서 미리 알린다. 키 값 자체는 절대 로깅하지 않는다(시크릿).
  if (import.meta.env.DEV && !chatKeySettings.get().apiKey && !import.meta.env.VITE_YUI_CHAT_KEY) {
    log.warn(
      "chat API 키 미설정 — chat은 무인증 placeholder로 호출돼 401 가능. 설정 패널의 채팅 API 키 또는 .env.local(VITE_YUI_CHAT_KEY) 참고.",
    );
  }
  // STT/openai-TTS 키 미설정 경고(키가 필요한 게이트 백엔드에서 401 방지용 힌트). irodori는 키 불필요.
  if (import.meta.env.DEV && !sttKeySettings.get().apiKey && !import.meta.env.VITE_YUI_STT_KEY) {
    log.warn(
      "STT API 키 미설정 — 키를 요구하는 STT 서버라면 401 가능. .env.local(VITE_YUI_STT_KEY) 참고.",
    );
  }
  if (import.meta.env.DEV && !ttsKeySettings.get().apiKey && !import.meta.env.VITE_YUI_TTS_KEY) {
    log.warn(
      "TTS API 키 미설정 — openai 호환 TTS가 키를 요구하면 401 가능. .env.local(VITE_YUI_TTS_KEY) 참고. (irodori는 불필요)",
    );
  }
  // synth는 호출 시점에 config(핫리로드)와 selectFetch를 읽는 closure로 주입한다.
  // config.get()을 여기서 eager 평가하면 load() 전 throw로 부트스트랩이 죽으니 금지.
  // 재생 진폭은 renderer 입 모양으로, 재생 완료는 말풍선 페이드 해제로 흐른다(speech-playback).
  // irodori synth closure를 화자·튜닝 키별로 메모이즈 + 422 self-heal. 문장마다 재구성하지 않는다.
  let irodoriFactory: TtsSynth | undefined;
  const irodoriSynth = async (input: string, signal?: AbortSignal): Promise<ArrayBuffer> => {
    const f = await selectFetch();
    irodoriFactory ??= createIrodoriSynthFactory({
      getParams: () => {
        const eps = getEndpoints();
        const active = speakerSelection.getActive();
        if (!eps.irodori_base_url || !active.id) {
          throw new Error("irodori provider requires irodori_base_url + irodori_speaker");
        }
        return {
          baseUrl: eps.irodori_base_url,
          referenceId: active.id,
          refUrl: active.ref_url,
          numSteps: eps.irodori_num_steps,
          cfgScaleText: eps.irodori_cfg_scale_text,
          cfgScaleSpeaker: eps.irodori_cfg_scale_speaker,
          seconds: eps.irodori_seconds,
        };
      },
      ensureRegistered,
      evictRegistration,
      buildSynth: (p, fetchImpl) =>
        createIrodoriSynth({
          baseUrl: p.baseUrl,
          referenceId: p.referenceId,
          fetch: fetchImpl,
          numSteps: p.numSteps,
          cfgScaleText: p.cfgScaleText,
          cfgScaleSpeaker: p.cfgScaleSpeaker,
          seconds: p.seconds,
        }),
      fetch: f ?? globalThis.fetch,
    });
    return irodoriFactory(input, signal);
  };

  // 추임새 루프는 speechPlayback로 말하고(speak), speechPlayback의 재생 종료(onPlaybackEnd)가
  // 루프의 다음 반복을 트리거한다 — 서로를 참조하므로 forward let으로 순환을 끊는다.
  let fillerLoop: import("./io/filler-loop").FillerLoop | undefined;
  // 현재 thinking을 소유한 턴의 token. 턴이 겹치면(supersede) 추월당한 턴의 늦은
  // onThinkingEnd가 단일 fillerLoop/모션을 정리하지 않게, token이 현재와 다르면 무시한다.
  let currentThinkingTurn: object | null = null;
  const speechPlayback = createSpeechPlayback({
    renderer,
    surfaces,
    onPlaybackEnd: () => fillerLoop?.onUtteranceDone(),
    pipeline: {
      sink: createWebAudioSink({ getGain: () => lipsyncSettings.get().gain }),
      // function form → drain마다 lazy 해소(eager config read 없음, 핫리로드 친화).
      maxInflight: () => getEndpoints().tts_max_inflight ?? 1,
      synth: async (input, signal) => {
        // TTS 비활성(토글 OFF 또는 서버 미설정) 시 조용히 skip — 표정/모션·말풍선은 그대로.
        if (!ttsSettings.get().enabled) return Promise.reject(TTS_SKIP);
        const eps = getEndpoints();
        if (eps.tts_provider === "irodori") {
          if (!eps.irodori_base_url || !speakerSelection.getActive().id) {
            return Promise.reject(TTS_SKIP);
          }
          return irodoriSynth(input, signal);
        }
        if (!eps.tts_base_url) return Promise.reject(TTS_SKIP);
        const f = await selectFetch();
        return createTtsSynth({
          config: eps,
          fetch: f,
          model: eps.tts_model,
          voice: eps.tts_voice,
          speed: eps.tts_speed,
          getApiKey: () => config.secrets.get(TTS_API_KEY_SECRET),
        })(input, signal);
      },
    },
  });
  if (import.meta.env.DEV) {
    import.meta.hot?.dispose(() => speechPlayback.dispose());
    Object.assign(globalThis as Record<string, unknown>, {
      __yuiSpeech: speechPlayback,
    });
  }

  // ── TTFT 추임새 ───────────────────────────────────────────────────────────
  // 호출 시점에 현재 filler 설정 + config 스냅샷을 라이브로 읽어 effective 풀을 만든다
  // (부트 시점 캡처 금지 — 핫리로드/설정 변경이 다음 턴에 반영되게).
  const effectiveFiller = () => effectiveFillerPool(fillerSettings.get(), config.get().filler);

  // 추임새 루프 — speak(speechPlayback) + 라이브 풀/타이밍. forward let에 대입해 순환을 닫는다.
  fillerLoop = createFillerLoop({
    speak: (t) => speechPlayback.onSpeech(t),
    getPools: effectiveFiller,
    getTiming: () => ({
      gapMs: config.get().filler.gap_ms,
      jitterMs: config.get().filler.gap_jitter_ms,
    }),
  });

  // ── 세션 연속성 ───────────────────────────────────────────────────────────
  // 대화 스레딩은 OpenAI Responses의 previous_response_id로 잇는다 — 매 턴 직전 id를 읽어
  // 보내고(getPreviousResponseId), 성공한 턴의 새 response id를 저장한다(onResponseId).
  // session store는 위에서 wireStorageSync 대상으로 일찍 만든다.
  const backendCaller = createBackendCaller({
    get config() {
      return getEndpoints();
    },
    renderer,
    getApiKey: () => config.secrets.get(CHAT_API_KEY_SECRET),
    getFetch: () => selectFetch(),
    getPreviousResponseId: () => sessionStore.get() ?? undefined,
    onResponseId: (id) => sessionStore.set(id),
    transcript: chatHistoryStore,
    onUsage: (usage) => {
      sessionDiagnostics.setUsage(
        usage.total_tokens,
        getEndpoints().chat_model_context_window ?? null,
      );
    },
    onSpeech: (text) => speechPlayback.onSpeech(text),
    onSpeechDelta: (text) => speechPlayback.onSpeechDelta(text),
    onSpeechEnd: () => speechPlayback.onSpeechEnd(),
    onSpeechInterrupt: () => speechPlayback.interrupt(),
    onSpeechAbort: () => speechPlayback.abort(),
    onCue: (cue) => speechPlayback.setCue(cue),
    getScreenshot: async () => {
      const s = screenshotSettings.get();
      if (!s.enabled) return undefined;
      const cap = await screenCapturer.capture(s.source);
      return buildScreenshotBlock(s, cap ?? undefined);
    },
    getOsContext: () => osContext.get(),
    getAgentSettings: () => agentSettings.get(),
    // TTFT thinking: 디스패처는 타이밍만 소유 — effective 풀이 비어있지 않을 때만 타이머 무장.
    getFiller: () => {
      const pool = effectiveFiller();
      return pool.first.length > 0 || pool.repeat.length > 0;
    },
    // 첫 토큰 지연 시: 생각중 모션(loop) + 추임새 루프 시작(첫 대사 → 반복). 루프가 말하기를 소유한다.
    onThinkingStart: (token) => {
      // 이 턴이 thinking을 소유한다고 동기로 선언 — 겹친 다음 턴 start가 추월하면 갱신된다.
      currentThinkingTurn = token;
      // hold BEFORE the first filler can speak so no filler sentence resets the motion.
      speechPlayback.holdMotion(true);
      // Motion yields when a higher-priority state is current (e.g. window_sit perch:
      // thinking is interrupt_policy "ignore"), but the filler voice always speaks —
      // the utterance is independent of the motion decision.
      renderer.playMotion({ id: "thinking", loop: true });
      fillerLoop?.start();
    },
    // thinking 종료 → 추임새 루프 정지 + idle baseline 복귀. thinking은 loop:true/kind:"state"라
    // cue가 없으면 영영 돌고 previousStable도 오염되므로, 종료 시 idle로 되돌려 둘 다 막는다.
    // (backend 모션 cue priority 70은 도착 시 idle을 그대로 대체한다.)
    // 추월당한 턴의 늦은 end(token != current)는 무시 — 단일 fillerLoop/모션이 현재 턴 소유다.
    onThinkingEnd: (token) => {
      if (token !== currentThinkingTurn) return;
      currentThinkingTurn = null;
      speechPlayback.holdMotion(false);
      fillerLoop?.stop();
      renderer.playMotion(null);
    },
  });
  // dispatcher/guardrails는 config 로드 후 만든다(guardrails가 cfg.guardrails 수치를 필요로 함).
  try {
    const cfg = await config.load();
    // 가드레일 — config 수치로 구성. dispatcher가 note+evaluate+cooldown polling으로 소비.
    const guardrails = createGuardrails(cfg.guardrails);
    guardrailsRef = guardrails;
    const dispatcher = createDispatcher({
      bus,
      renderer,
      backendCaller,
      guardrails,
      // user-initiated 턴 실패만 표면화(proactive/schedule/github/agent는 로그만 — silent by design).
      // source(text/voice)로 라우팅한다 — isInputOpen()을 실패 시점에만 보고 판단하면 Escape로
      // 중도 닫힌 typed 턴이 voice 표면으로 오배선될 수 있어, routeTurnFailure가 source를 우선한다.
      onUserTurnFailed: (reason, source) => {
        const message = turnErrorMessage(reason);
        if (!message) return;
        const action = routeTurnFailure(source, surfaces.isInputOpen());
        if (action.kind === "show_input_error") {
          surfaces.showInputError(message);
        } else if (action.kind === "voice_error") {
          // voice-input-indicator의 기존 error 상태를 잠깐 재사용한다(새 DOM 없음). 겹친 실패가
          // 이전 타이머로 새 표시를 일찍 끊지 않도록 재무장 전 clearTimeout.
          if (voiceTurnErrorTimer !== null) clearTimeout(voiceTurnErrorTimer);
          voiceInputStatus.set("error", reason);
          voiceTurnErrorTimer = setTimeout(() => {
            voiceTurnErrorTimer = null;
            if (voiceInputStatus.get().state === "error") voiceInputStatus.set("listening");
          }, VOICE_TURN_ERROR_DISPLAY_MS);
        }
        // action.kind === "none": typed 턴이 실패 도달 전 이미 닫혔다 — 로그만(dispatcher가 이미 남김).
      },
    });
    dispatcherRef = dispatcher;
    // 진행 중 backend 턴 ⟷ 입력의 send/stop 토글. stop 클릭 → 명시적 cancel(client-side abort).
    dispatcher.subscribeBusy((busy) => surfaces.setBusy(busy));
    surfaces.onStop(() => dispatcher.cancel());
    // HMR로 모듈이 재실행되면 이전 dispatcher의 setInterval/ in-flight가 남는다 → dispose에서 정지.
    if (import.meta.env.DEV) {
      import.meta.hot?.dispose(() => {
        dispatcher.stop();
        if (voiceTurnErrorTimer !== null) clearTimeout(voiceTurnErrorTimer);
        proactiveSourceRef?.stop();
        scheduleSourceRef?.stop();
        githubSourceRef?.stop();
        agentSourceRef?.stop();
        sessionStore.dispose();
        sessionDiagnostics.dispose();
        chatHistoryStore.dispose();
      });
    }
    const { createSttVad } = await import("./io/stt-vad");
    sttVad = createSttVad({
      config: cfg.endpoints,
      // lazy: VAD가 시작될 때마다 침묵 기준을 다시 읽어 슬라이더 변경이 반영되게 한다.
      silenceMs: () => vadSettings.get().silenceMs,
      getApiKey: () => config.secrets.get(STT_API_KEY_SECRET),
      onVoiceSegment: (transcript) => {
        userInput.submitVoice(transcript);
        proactiveSourceRef?.noteInteraction();
      },
      onState: (state, detail) => voiceInputStatus.set(state, detail),
    });
    voiceInputReady = true;
    // 직전 세션에서 켜둔 채 종료했으면(sttSettings.enabled) 자동 재개. 단일 start로 통일하고,
    // 서버 미설정이면 start()가 no-op라 onState가 안 와 status는 조용히 idle로 남는다.
    if (
      voiceInputStartRequested ||
      voiceInputStatus.get().state !== "idle" ||
      sttSettings.get().enabled
    ) {
      void startVoiceInput();
    }
    // emotion/motion registry를 renderer에 주입 → setEmotion/playMotion(=applyDirective) 동작.
    renderer.setEmotionRegistry(cfg.emotionRegistry);
    renderer.setMotionRegistry(cfg.motions);
    // 전신 fit-to-bounds framing knob 주입 — 첫 VRM 로드 전에 설정.
    renderer.setFraming(cfg.avatar.framing ?? {});
    // 카메라 시선 맞춤 thresholds 주입 (configs/avatar.json gaze; 생략 키는 기본값 유지).
    renderer.setGaze(cfg.avatar.gaze ?? {});
    // per-pixel alpha hit-test threshold (configs/avatar.json hit_test.alpha_threshold).
    const bootAlpha = cfg.avatar.hit_test?.alpha_threshold;
    if (bootAlpha !== undefined) renderer.setHitTestThreshold(bootAlpha);
    // 실제 manifest 주입 후 부트 로드 → persist된 override가 시작 시점에 적용된다.
    vrmSelection.setManifest({
      available: cfg.avatar.available,
      defaultUrl: cfg.avatar.vrm_url,
    });
    speakerSelection.setManifest({
      available: cfg.endpoints.irodori_voices,
      defaultId: cfg.endpoints.irodori_speaker ?? "",
    });
    await loadVrmSerialized(vrmSelection.getActive().url);
    // 클릭스루 hit-test: 캐릭터/가시 UI 위는 interactive, 그 외 빈 영역은 click-through.
    // interactive = renderer.hitTest(stage-local) ∪ 가시 입력 폼 ∪ 열린 quick-controls.
    // 좌표는 모두 viewport(client) 기준 — renderer.hitTest만 stage 좌상단 기준으로 변환한다.
    const interactiveRects = (): DOMRect[] => {
      const rects: DOMRect[] = [];
      const inputForm = root.querySelector<HTMLElement>(".yui-input.is-open");
      if (inputForm) rects.push(inputForm.getBoundingClientRect());
      if (quickControls.isOpen()) rects.push(quickControls.el.getBoundingClientRect());
      return rects;
    };
    const pointInRect = (x: number, y: number, r: DOMRect, margin: number): boolean =>
      x >= r.left - margin &&
      x <= r.right + margin &&
      y >= r.top - margin &&
      y <= r.bottom + margin;
    const hitTest = createHitTestController({
      isOverInteractive: (xClient, yClient, marginPx) => {
        const stageRect = stage.getBoundingClientRect();
        if (renderer.hitTest(xClient - stageRect.left, yClient - stageRect.top)) return true;
        return interactiveRects().some((r) => pointInRect(xClient, yClient, r, marginPx));
      },
      moveTarget: window,
      // 핫리로드 친화: 매 tick config store에서 읽어 knob 편집이 반영되게 한다.
      getConfig: () => config.get().avatar.hit_test ?? {},
    });
    hitTestRef = hitTest;
    hitTest.start();
    if (import.meta.env.DEV) import.meta.hot?.dispose(() => hitTest.stop());
    // config가 준비된 후에만 dispatcher를 가동(backend_caller가 config.get()에 의존).
    dispatcher.start();
    // tier2 발화 후보 소스: presence 게이트 위에서 proactive.<id>(무대화 N분)와
    // schedule.<id>(시간대 인사)를 발사한다. 공유 presence store + 각 설정 store로
    // 게이팅. dispatcher 가동 후 start — 발사가 즉시 소비되도록. teardown에서 함께 stop.
    const proactiveSource = createProactiveSource({
      bus,
      present_max_idle_ms: presenceSettings.get().present_max_idle_ms,
      getCues: () => proactiveSettings.get().entries,
      isEnabled: () => proactiveSettings.get().enabled,
    });
    proactiveSourceRef = proactiveSource;
    void proactiveSource.start();
    const scheduleSource = createScheduleSource({
      bus,
      present_max_idle_ms: presenceSettings.get().present_max_idle_ms,
      getCues: () => scheduleSettings.get().entries,
      isEnabled: () => scheduleSettings.get().enabled,
    });
    scheduleSourceRef = scheduleSource;
    void scheduleSource.start();
    // GitHub PR 워처: 자체 폴 루프로 open PR의 CI/리뷰 edge를 github.<event>로 발사한다.
    // proactive와 같은 presence 임계를 재사용하되 게이트 방향이 반대(LOW idle에서 발사).
    const lastSeenStore = localStorageStore<LastSeenMap>("yui.github.lastSeen");
    const githubSource = createGithubSource({
      bus,
      githubQuery,
      present_max_idle_ms: presenceSettings.get().present_max_idle_ms,
      isEnabled: () => githubSettings.get().enabled,
      getPollIntervalMs: () => githubSettings.get().poll_interval_ms,
      lastSeenStore,
    });
    githubSourceRef = githubSource;
    void githubSource.start();
    // Agent completion 워처: Tauri IPC 인박스에서 agent.done / idle→present edge에서 agent.catchup을 발사한다.
    const agentSource = createAgentSource({
      bus,
      present_max_idle_ms: presenceSettings.get().present_max_idle_ms,
      isEnabled: () => agentNotifySettings.get().enabled,
    });
    agentSourceRef = agentSource;
    void agentSource.start();
    // 전역 소환 핫키: configs/hotkeys.json accelerator를 OS 전역으로 등록(Tauri 전용 —
    // 브라우저 dev에서는 스킵). 발동 시 창 show+focus 후 입력 소환. 등록 실패는
    // summon-hotkey가 warn 후 비활성으로 처리한다(fail-soft).
    if ((globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
      void (async () => {
        const { register, unregister } = await import("@tauri-apps/plugin-global-shortcut");
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const summonHotkey = createSummonHotkey({
          register,
          unregister,
          // macOS에서 백그라운드 앱 활성화까지 포함해 앞으로 가져온다(숨김 대비 show 선행).
          focusWindow: async () => {
            const win = getCurrentWindow();
            await win.show();
            await win.setFocus();
          },
          summonInput: () => surfaces.summonInput(),
          isInputOpen: () => surfaces.isInputOpen(),
        });
        summonHotkeyRef = summonHotkey;
        await summonHotkey.apply(cfg.hotkeys.summon_global);
        if (import.meta.env.DEV) {
          import.meta.hot?.dispose(() => void summonHotkey.dispose());
        }
      })().catch((err) => log.warn("summon_hotkey_wire_failed", { error: String(err) }));
    }
    // Expression Broker publish(D6): broker_base_url이 있을 때만 가동(override 병합 effective 기준).
    // publish→start는 fire-and-forget — 부트 임계 경로를 막지 않는다(D4).
    const bootEps = getEndpoints();
    brokerFetch = (await selectFetch()) ?? undefined;
    if (bootEps.broker_base_url) {
      const table = await loadBrokerTable(bootEps.tts_provider);
      brokerRef = makeBroker(bootEps.broker_base_url);
      const payload = deriveBrokerPayload({ ...cfg, endpoints: bootEps }, table);
      void brokerRef.publish(payload).then(() => brokerRef?.start());
    } else {
      log.debug("broker_disabled", { reason: "no_broker_base_url" });
    }

    // 오버라이드(음성 엔진·broker URL) 변경을 라이브로 broker에 반영. config.subscribe는
    // 디스크 편집만 보므로 별도로 배선한다(best-effort).
    const brokerReconciler = createBrokerOverrideReconciler({
      getEffectiveEndpoints: getEndpoints,
      getBroker: () => brokerRef,
      setBroker: (b) => {
        brokerRef = b;
      },
      createBroker: makeBroker,
      loadTable: loadBrokerTable,
      derivePayload: (eff, table) =>
        deriveBrokerPayload({ ...config.get(), endpoints: eff }, table),
    });
    const unsubscribeBrokerOverride = endpointsSettings.subscribe(() => {
      void brokerReconciler.onChange();
    });
    if (import.meta.env.DEV) import.meta.hot?.dispose(unsubscribeBrokerOverride);
  } catch (err) {
    log.error("config_or_vrm_load_failed", { error: String(err) });
  }

  // 핫리로드: avatar manifest가 바뀌면 setManifest로 갱신 후 active VRM 핫스왑.
  // override-wins: config vrm_url 편집은 사용자의 localStorage 선택을 덮지 않는다(agent-settings와 동일).
  config.subscribe((cfg, changed) => {
    // emotion/motion registry 핫리로드 → renderer 재주입(즉시 반영).
    if (changed.has("emotionRegistry")) renderer.setEmotionRegistry(cfg.emotionRegistry);
    if (changed.has("motions")) renderer.setMotionRegistry(cfg.motions);
    // guardrails 수치 핫리로드 — 런타임 DND/카운터 상태는 보존하고 config만 교체.
    if (changed.has("guardrails")) guardrailsRef?.setConfig(cfg.guardrails);
    // 전역 소환 핫키 핫리로드 — 기존 해제 후 새 accelerator 등록(빈 문자열 = 비활성).
    if (changed.has("hotkeys")) void summonHotkeyRef?.apply(cfg.hotkeys.summon_global);
    // irodori 화자 manifest 핫리로드 — synth가 다음 발화에서 getActive()로 읽으므로 재로드만 한다.
    if (changed.has("endpoints")) {
      speakerSelection.setManifest({
        available: cfg.endpoints.irodori_voices,
        defaultId: cfg.endpoints.irodori_speaker ?? "",
      });
    }
    // broker re-publish(D6): renderable vocab을 만드는 config 섹션이 바뀌면 동기화. best-effort.
    // override 병합 effective 엔드포인트로 발행해 디스크 편집이 사용자 오버라이드를 덮지 않게 한다.
    if (
      brokerRef &&
      (changed.has("emotionRegistry") || changed.has("motions") || changed.has("endpoints"))
    ) {
      const eff = getEndpoints();
      void loadBrokerTable(eff.tts_provider).then((table) => {
        void brokerRef?.publish(deriveBrokerPayload({ ...cfg, endpoints: eff }, table));
      });
    }
    if (!changed.has("avatar")) return;
    // framing knob 핫리로드 — 핫스왑 재fit 전에 갱신.
    renderer.setFraming(cfg.avatar.framing ?? {});
    // gaze thresholds 핫리로드.
    renderer.setGaze(cfg.avatar.gaze ?? {});
    const reloadAlpha = cfg.avatar.hit_test?.alpha_threshold;
    if (reloadAlpha !== undefined) renderer.setHitTestThreshold(reloadAlpha);
    vrmSelection.setManifest({
      available: cfg.avatar.available,
      defaultUrl: cfg.avatar.vrm_url,
    });
    void loadVrmSerialized(vrmSelection.getActive().url).catch((err) =>
      log.error("vrm_hot_swap_failed", { error: String(err) }),
    );
  });
  config.onError((err) =>
    log.error("config_reload_failed", {
      kept_previous: true,
      error: String(err),
    }),
  );
  // dev에서만 폴링 watcher 가동 — configs/*.json 편집 시 즉시 반영.
  if (import.meta.env.DEV) {
    config.start();
    Object.assign(globalThis as Record<string, unknown>, {
      __yuiConfig: config,
    });
    // HMR로 모듈이 재실행되면 이전 store의 setInterval이 쌓인다 → dispose에서 중지.
    import.meta.hot?.dispose(() => config.stop());
    // broker liveness poll의 setInterval도 HMR 간에 누수되지 않게 정리한다.
    import.meta.hot?.dispose(() => brokerRef?.dispose());
  }
}

/** 포커스가 이미 입력류에 있으면 핫키를 가로채지 않는다. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

void bootstrap();
