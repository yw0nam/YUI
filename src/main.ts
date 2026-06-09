/**
 * YUI bootstrap.
 *
 * 최종 그래프 (concept.md §0, event-dispatcher.md §2):
 *   loadConfig() → createRenderer(mount) → createTier1Engine(renderer)
 *               → createEventBus() + createGuardrails()
 *               → createDispatcher({ bus, guardrails, renderer })
 *               → sources(timer/idle/user_input + Rust os_event) 구독 → dispatcher.start()
 *   io: streamChat(SSE) → express + 텍스트 스트림 → renderer / surfaces / tts-pipeline(#14).
 *
 * 현재 = #4 renderer + UI surfaces 목업:
 *   - .yui-stage: 투명 캐릭터 무대(드래그 영역). renderer가 캔버스로 채운다.
 *   - .yui-ui:    오버레이 — 발화 말풍선·툴상태·텍스트 입력(invisible-by-default).
 *   실데이터(chat-client SSE / tts) 배선은 후속. 지금은 mock 드라이버가 surface를 구동한다.
 */

import "./styles.css";
import { createLogger, initLogger } from "./logger";
import { createRenderer } from "./renderer";
import { nextZoom } from "./renderer/camera-fit";
import { createTier1Engine } from "./ambient/tier1";
import { createSurfaces } from "./ui/surfaces";
import { createMockDriver } from "./ui/mock";
import { createQuickControls } from "./ui/quick-controls";
import { createCaptureIndicator } from "./ui/capture-indicator";
import { createVoiceInputStatus } from "./ui/voice-input-status";
import { createVoiceInputIndicator } from "./ui/voice-input-indicator";
import { createScreenshotSettings, localStorageScreenshotStorage } from "./io/screenshot-settings";
import { createLipsyncSettings, localStorageLipsyncStorage } from "./io/lipsync-settings";
import { createAgentSettings, localStorageAgentStorage } from "./io/agent-settings";
import {
  createEndpointsSettings,
  localStorageEndpointsStorage,
  mergeEndpoints,
} from "./io/endpoints-settings";
import {
  createCameraSettings,
  localStorageCameraStorage,
  CAMERA_ZOOM_MIN,
  CAMERA_ZOOM_MAX,
  CAMERA_WHEEL_SENSITIVITY,
} from "./io/camera-settings";
import { createVrmSelection, localStorageVrmStorage } from "./io/vrm-selection";
import {
  createSpeakerSelection,
  localStorageSpeakerStorage,
  type SpeakerOption,
} from "./io/speaker-selection";
import { createSettingsWindowOpener, wireStorageSync } from "./io/settings-window";
import { createSettingsBridge } from "./io/settings-bridge";
import { createWebAudioSink } from "./io/audio-player";
import { resolveScreenSourceProvider, resolveScreenCapturer } from "./io/tauri-screen";
import { buildScreenshotBlock } from "./io/screenshot-context";
import { createOsContext } from "./io/os-context";
import { createConfigStore, plainSecretProvider, CHAT_API_KEY_SECRET, loadEmotionTextTable } from "./config";
import { createBrokerClient, deriveBrokerPayload, type BrokerClient } from "./io/broker-client";
import { initDrag } from "./drag";
import { selectFetch } from "./io/chat-client";
import { createSpeechPlayback } from "./io/speech-playback";
import { createTtsSynth } from "./io/tts-synth";
import { createIrodoriSynth, type TtsSynth } from "./io/irodori-synth";
import { ensureRegistered, evictRegistration, updateVoice } from "./io/irodori-voices";
import { createIrodoriSynthFactory } from "./io/irodori-synth-factory";
import { createEventBus } from "./dispatcher/event-bus";
import { createBackendCaller } from "./dispatcher/backend-caller";
import { createDispatcher, type Dispatcher } from "./dispatcher/dispatcher";
import { createUserInputSource } from "./dispatcher/user-input-source";
import type { SttVad } from "./io/stt-vad";

/** 입력 소환 핫키 (window-focus 한정 — 전역 단축키는 후속 tauri-plugin-global-shortcut). */
const SUMMON_KEY = "/";

const log = createLogger("bootstrap");

async function bootstrap(): Promise<void> {
  await initLogger();
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) {
    throw new Error("#app mount point not found");
  }

  // 루트(포지셔닝 컨텍스트) > 무대(드래그) + 오버레이(surfaces).
  // 정밀 per-region hit-test는 #8/#9. 지금은 무대 = 드래그, 오버레이 = pointer 통과(입력만 예외).
  // Note: data-tauri-drag-region removed — drag is handled via initDrag (Issue #9)
  // so we get the gesture-stub seam and can apply per-region filtering later (#8).
  app.innerHTML = `
    <div class="yui-root">
      <div class="yui-stage"></div>
    </div>
  `;
  const root = app.querySelector<HTMLDivElement>(".yui-root")!;
  const stage = root.querySelector<HTMLDivElement>(".yui-stage")!;

  // Drag: pointerdown on stage → OS-native drag via Tauri IPC.
  // onScaleChanged listener installed inside for DPI-change seam (Issue #9 F2).
  const cleanupDrag = await initDrag(stage);

  // 마우스 휠로 캐릭터 스케일(#106): 클램프 경계·민감도는 io 상수, persist는 store가 소유.
  // 드래그는 pointerdown만 쓰므로 wheel과 충돌하지 않는다(drag.ts).
  const onWheelZoom = (e: WheelEvent): void => {
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
  // Tier 1 ambient(#10): backend 독립, 항상 ON. tick은 vrm 로드 후부터 발화하므로
  // loadVRM 전에 start해도 안전 (vrm 없는 프레임은 no-op).
  const ambient = createTier1Engine(renderer);
  ambient.start();
  const surfaces = createSurfaces({ mount: root });
  const mock = createMockDriver(surfaces);

  const screenshotSettings = createScreenshotSettings({ storage: localStorageScreenshotStorage() });
  const lipsyncSettings = createLipsyncSettings({ storage: localStorageLipsyncStorage() });
  const agentSettings = createAgentSettings({ storage: localStorageAgentStorage() });
  // 사용자 편집 엔드포인트 오버라이드(#95): localStorage가 bundled config를 덮는다(빈 값=폴백).
  const endpointsSettings = createEndpointsSettings({ storage: localStorageEndpointsStorage() });
  // config.endpoints 위에 오버라이드를 얹은 effective 엔드포인트. 호출 시점에 평가(핫리로드 친화).
  function getEndpoints(): ReturnType<typeof config.get>["endpoints"] {
    return mergeEndpoints(config.get().endpoints, endpointsSettings.get());
  }
  // 카메라 줌(#106): persist된 배율을 부트 시 적용하고, 변경(휠/크로스윈도우)마다 렌더러로 흘린다.
  const cameraSettings = createCameraSettings({ storage: localStorageCameraStorage() });
  renderer.setZoom(cameraSettings.get().zoom);
  cameraSettings.subscribe((s) => renderer.setZoom(s.zoom));
  const voiceInputStatus = createVoiceInputStatus();
  const screenSourceProvider = resolveScreenSourceProvider();
  const screenCapturer = resolveScreenCapturer();
  // foreground app/title 스냅샷(#18) — backend_caller가 매 요청에 env로 첨부. non-Tauri면 no-op.
  const osContext = createOsContext();
  void osContext.start();
  // 팝아웃: Tauri면 별도 WebviewWindow("settings"), 아니면 브라우저 창. 메인 창 편집을
  // 거기서, 거기 편집을 여기서 반영하도록 wireStorageSync로 storage 이벤트를 양방향 연결한다.
  const openSettings = createSettingsWindowOpener();
  const disposeStorageSync = wireStorageSync([agentSettings, endpointsSettings, lipsyncSettings, screenshotSettings, cameraSettings]);

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
    log.info("음성 토글 수신(별도 창)", { on });
    voiceInputStatus.set(on ? "listening" : "idle");
  });
  // 음성 상태(이 창 → 별도 창): 별도 창 indicator가 실제 STT 상태를 반영하게.
  voiceInputStatus.subscribe((snapshot) => {
    bridge.emitVoiceState({ state: snapshot.state, detail: snapshot.detail });
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
  agentSettings.subscribe(broadcastSettings);
  endpointsSettings.subscribe(broadcastSettings);
  lipsyncSettings.subscribe(broadcastSettings);
  screenshotSettings.subscribe(broadcastSettings);
  cameraSettings.subscribe(broadcastSettings);
  bridge.onSettingsChanged(() => {
    applyingRemote = true;
    try {
      agentSettings.reloadFromStorage();
      endpointsSettings.reloadFromStorage();
      lipsyncSettings.reloadFromStorage();
      screenshotSettings.reloadFromStorage();
      // 줌 재로드 → cameraSettings.subscribe(s => renderer.setZoom)가 카메라까지 반영.
      cameraSettings.reloadFromStorage();
      // VRM 선택은 설정 창에서 store-only로 커밋되므로, 그 변경을 펫 창 렌더러로 반영.
      // 이 창 자체 스왑은 swapVrm이 이미 로드하므로, 여기선 OTHER 창 변경만 → 이중 로드 회피.
      const prevVrmUrl = vrmSelection.getActive().url;
      vrmSelection.reloadFromStorage();
      const nextVrmUrl = vrmSelection.getActive().url;
      if (nextVrmUrl !== prevVrmUrl) {
        void loadVrmSerialized(nextVrmUrl).catch((err) =>
          log.error("VRM cross-window swap failed:", err),
        );
      }
      // 화자 선택은 store-only — synth가 다음 발화에서 getActive()로 읽으므로 재로드만 한다.
      speakerSelection.reloadFromStorage();
    } finally {
      applyingRemote = false;
    }
    log.info("설정 변경 수신(별도 창) — 재로드");
  });
  // VRM 선택 store + 스왑(#94). 펫 창은 renderer-backed: loadVRM 성공 시에만 store 커밋.
  // config 로드 전이라 fallback default로 시작 — 패널이 일찍 필요하기 때문. config 로드 후
  // setManifest로 실제 available[]를 주입한다(아래 부트 시퀀스).
  const vrmSelection = createVrmSelection({
    defaultUrl: "/vrms/carlotta.vrm",
    storage: localStorageVrmStorage(),
  });
  // 단일 직렬 스왑 경로: 사용자 스왑·부트·config 핫리로드·크로스윈도우가 모두 이 체인을
  // 통과한다. loadVRM은 재진입 안전하지 않으므로 직렬화하되, 실패는 호출자에게 전파한다.
  let vrmSwap = Promise.resolve();
  function loadVrmSerialized(url: string): Promise<void> {
    const next = vrmSwap.then(() => renderer.loadVRM(url));
    vrmSwap = next.catch(() => {}); // 체인은 실패해도 살려두고
    return next; // 이 호출자에게만 reject를 전파한다.
  }
  // 로드 성공 시에만 store 커밋. 실패하면 await가 throw → store 미커밋(UI가 에러+자동 복구).
  const swapVrm = async (option: { id: string; url: string }): Promise<void> => {
    await loadVrmSerialized(option.url);
    vrmSelection.select(option.id);
  };
  // 이 창에서 고른 VRM을 설정 창 UI에 반영하기 위해 cross-window로 알린다(루프 가드는 broadcastSettings).
  vrmSelection.subscribe(broadcastSettings);

  // irodori 화자 선택 store(PR-B). config 로드 전이라 빈 fallback으로 시작 — 패널이 일찍
  // 필요하기 때문. config 로드 후 setManifest로 실제 irodori_voices·default를 주입한다.
  const speakerSelection = createSpeakerSelection({
    defaultId: "",
    storage: localStorageSpeakerStorage(),
  });
  // 선택 → irodori voice registry 등록 후 store 커밋(swapVrm의 load-then-select 미러).
  const swapSpeaker = async (option: SpeakerOption): Promise<void> => {
    const f = await selectFetch();
    const eps = getEndpoints();
    if (eps.irodori_base_url) {
      await ensureRegistered({
        baseUrl: eps.irodori_base_url,
        id: option.id,
        refUrl: option.ref_url,
        fetch: f,
      });
    }
    speakerSelection.select(option.id);
  };
  // 참조 음성 재등록(#103, PUT /voices) — 서버 측 force-refresh만, 화자 선택은 바꾸지 않는다.
  const refreshSpeaker = async (option: SpeakerOption): Promise<void> => {
    const f = await selectFetch();
    const eps = getEndpoints();
    if (!eps.irodori_base_url) throw new Error("irodori provider requires irodori_base_url");
    await updateVoice({ baseUrl: eps.irodori_base_url, id: option.id, refUrl: option.ref_url, fetch: f });
  };
  // 이 창에서 고른 화자를 설정 창 UI에 반영하기 위해 cross-window로 알린다.
  speakerSelection.subscribe(broadcastSettings);

  const quickControls = createQuickControls({
    mount: root,
    settings: screenshotSettings,
    sourceProvider: screenSourceProvider,
    voiceStatus: voiceInputStatus,
    lipsync: lipsyncSettings,
    agentSettings,
    vrmSelection,
    swapVrm,
    speakerSelection,
    swapSpeaker,
    refreshSpeaker,
    onGainPreview: (mouthOpen) => renderer.setMouthOpen(mouthOpen),
    onGainPreviewEnd: () => renderer.stopMouth(),
    // 빈 instructions일 때 placeholder로 보여줄 기본 지침(config 미로드 시 무시).
    getDefaultInstructions: () => {
      try {
        return getEndpoints().chat_instructions;
      } catch {
        return undefined;
      }
    },
    endpointsSettings,
    getEndpointDefaults: () => {
      try {
        const e = config.get().endpoints;
        return {
          chat_base_url: e.chat_base_url,
          stt_base_url: e.stt_base_url,
          tts_base_url: e.tts_base_url,
          irodori_base_url: e.irodori_base_url ?? "",
          chat_model: e.chat_model ?? "",
        };
      } catch {
        return undefined;
      }
    },
    onPopOut: () => openSettings(),
  });
  const captureIndicator = createCaptureIndicator({
    mount: root,
    settings: screenshotSettings,
    onActivate: () => quickControls.open(),
  });
  const voiceInputIndicator = createVoiceInputIndicator({
    mount: root,
    status: voiceInputStatus,
    onActivate: () => quickControls.open(),
  });

  function onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    quickControls.open({ x: e.clientX, y: e.clientY });
  }
  stage.addEventListener("contextmenu", onContextMenu);

  if (import.meta.env.DEV) {
    import.meta.hot?.dispose(() => {
      quickControls.dispose();
      if (broadcastTimer) clearTimeout(broadcastTimer);
      bridge.dispose();
      disposeStorageSync();
      captureIndicator.dispose();
      voiceInputIndicator.dispose();
      unsubscribeVoiceInputStatus();
      void sttVad?.dispose();
      voiceInputStatus.dispose();
      screenshotSettings.dispose();
      lipsyncSettings.dispose();
      agentSettings.dispose();
      endpointsSettings.dispose();
      cameraSettings.dispose();
      vrmSelection.dispose();
      speakerSelection.dispose();
      osContext.stop();
      stage.removeEventListener("contextmenu", onContextMenu);
    });
  }

  // ── Dispatcher spine (#21) ────────────────────────────────────────────────
  // event_bus → dispatcher → backend_caller → streamChat → Hermes → ControlEnvelope →
  // renderer.applyDirective. user.text_submitted가 이 루프를 구동한다.
  // bus/dispatcher는 config 로드 전에 만들어도 안전(엔드포인트는 backend_caller가 호출 시점에
  // config에서 읽는다). 다만 backend_caller는 config 스토어가 필요하므로 config 생성 후 배선한다.
  const bus = createEventBus({
    onDrop: (env, reason) =>
      log.info("drop", { event_name: env.event_name, reason }),
  });
  const userInput = createUserInputSource(bus);
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
  // broker client는 config 로드 후 broker_base_url이 있을 때만 만든다. 핫스왑 재publish와
  // HMR dispose가 닿게 holder를 둔다.
  let brokerRef: BrokerClient | null = null;

  // irodori provider일 때만 enum 테이블을 best-effort 로드. 실패하면 warn 후 null →
  // broker가 free 모드로 degrade(D4). 부트/핫스왑을 막지 않는다.
  async function loadBrokerTable(
    provider: string | undefined,
  ): Promise<Record<string, string> | null> {
    if (provider !== "irodori") return null;
    try {
      return await loadEmotionTextTable({ provider: "irodori" });
    } catch (err) {
      log.warn("broker: irodori emotion_text 로드 실패 — free 모드로 degrade", { err: String(err) });
      return null;
    }
  }

  // 제출 → 입력 닫고 dispatcher 스파인으로 발사(user.text_submitted). mock은 dev 데모 전용으로 유지.
  surfaces.onSubmit((text) => {
    surfaces.dismissInput();
    userInput.submit(text);
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

  // dev 전용: 스크린샷 검증 루프(#12)에서 직접 호출할 핸들.
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
      // 프로덕션 chat UI는 #18(mock-HTML 승인 게이트). 이건 검증용 임시 핸들이다.
      __yui_send: (text: string) => userInput.submit(text),
      // dispatcher 관찰(§11): __yui_dispatcher.inFlight()/queue()/recentDrops().
      __yui_dispatcher: () => dispatcherRef,
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

  // config-driven 로드 (#22, F8): configs/*.json → 검증된 AppConfig. endpoints/motions 등은
  // dispatcher(#21)·tts(#14) 배선 시 소비. 지금은 avatar.vrm_url로 VRM을 띄운다.
  // chat 키는 SecretProvider로 주입 — dev는 Vite env, prod/OSS는 keychain 구현으로 교체(concept §2.F).
  // dispatcher가 streamChat 호출 시 `await config.secrets.get(CHAT_API_KEY_SECRET)`로 해소한다.
  const config = createConfigStore({
    secrets: plainSecretProvider({
      [CHAT_API_KEY_SECRET]: import.meta.env.VITE_YUI_CHAT_KEY,
    }),
  });
  // dev에서 키를 빼먹으면 나중에 chat 호출 시 조용한 401처럼 보인다 → bootstrap에서 미리 알린다.
  if (import.meta.env.DEV && !import.meta.env.VITE_YUI_CHAT_KEY) {
    log.warn("VITE_YUI_CHAT_KEY 미설정 — chat은 무인증 placeholder로 호출돼 401 가능. .env.local 참고(.env.example).");
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

  const speechPlayback = createSpeechPlayback({
    renderer,
    surfaces,
    pipeline: {
      sink: createWebAudioSink({ getGain: () => lipsyncSettings.get().gain }),
      // function form → drain마다 lazy 해소(eager config read 없음, 핫리로드 친화).
      maxInflight: () => getEndpoints().tts_max_inflight ?? 1,
      synth: async (input, signal) => {
        const eps = getEndpoints();
        if (eps.tts_provider === "irodori") {
          return irodoriSynth(input, signal);
        }
        const f = await selectFetch();
        return createTtsSynth({
          config: eps,
          fetch: f,
          model: eps.tts_model,
          voice: eps.tts_voice,
          speed: eps.tts_speed,
        })(input, signal);
      },
    },
  });
  if (import.meta.env.DEV) {
    import.meta.hot?.dispose(() => speechPlayback.dispose());
    Object.assign(globalThis as Record<string, unknown>, { __yuiSpeech: speechPlayback });
  }

  const backendCaller = createBackendCaller({
    get config() {
      return getEndpoints();
    },
    renderer,
    getApiKey: () => config.secrets.get(CHAT_API_KEY_SECRET),
    getFetch: () => selectFetch(),
    onSpeech: (text) => speechPlayback.onSpeech(text),
    onSpeechDelta: (text) => speechPlayback.onSpeechDelta(text),
    onSpeechEnd: () => speechPlayback.onSpeechEnd(),
    onSpeechInterrupt: () => speechPlayback.interrupt(),
    onSpeechAbort: () => speechPlayback.abort(),
    onEmotionText: (text) => speechPlayback.setEmotionText(text),
    getScreenshot: async () => {
      const s = screenshotSettings.get();
      if (!s.enabled) return undefined;
      const cap = await screenCapturer.capture(s.source);
      return buildScreenshotBlock(s, cap ?? undefined);
    },
    getOsContext: () => osContext.get(),
    getAgentSettings: () => agentSettings.get(),
  });
  const dispatcher = createDispatcher({ bus, renderer, backendCaller });
  dispatcherRef = dispatcher;
  // HMR로 모듈이 재실행되면 이전 dispatcher의 setInterval/ in-flight가 남는다 → dispose에서 정지.
  if (import.meta.env.DEV) {
    import.meta.hot?.dispose(() => dispatcher.stop());
  }

  try {
    const cfg = await config.load();
    const { createSttVad } = await import("./io/stt-vad");
    sttVad = createSttVad({
      config: cfg.endpoints,
      onVoiceSegment: (transcript) => userInput.submitVoice(transcript),
      onState: (state, detail) => voiceInputStatus.set(state, detail),
    });
    voiceInputReady = true;
    if (voiceInputStartRequested || voiceInputStatus.get().state !== "idle") {
      void startVoiceInput();
    }
    // emotion/motion registry를 renderer에 주입 → setEmotion/playMotion(=applyDirective) 동작.
    renderer.setEmotionRegistry(cfg.emotionRegistry);
    renderer.setMotionRegistry(cfg.motions);
    // 전신 fit-to-bounds framing knob 주입 (#106) — 첫 VRM 로드 전에 설정.
    renderer.setFraming(cfg.avatar.framing ?? {});
    // 실제 manifest 주입 후 부트 로드 → persist된 override가 시작 시점에 적용된다.
    vrmSelection.setManifest({ available: cfg.avatar.available, defaultUrl: cfg.avatar.vrm_url });
    speakerSelection.setManifest({
      available: cfg.endpoints.irodori_voices,
      defaultId: cfg.endpoints.irodori_speaker ?? "",
    });
    await loadVrmSerialized(vrmSelection.getActive().url);
    // config가 준비된 후에만 dispatcher를 가동(backend_caller가 config.get()에 의존).
    dispatcher.start();
    // Expression Broker publish(D6): broker_base_url이 있을 때만 가동. publish→start는
    // fire-and-forget — 부트 임계 경로를 막지 않는다(D4).
    if (cfg.endpoints.broker_base_url) {
      const table = await loadBrokerTable(cfg.endpoints.tts_provider);
      // Tauri webview에서 broker(localhost:3201)는 cross-origin → selectFetch로 CORS 우회 fetch 주입.
      const brokerFetch = await selectFetch();
      brokerRef = createBrokerClient({
        baseUrl: cfg.endpoints.broker_base_url,
        ...(brokerFetch ? { fetch: brokerFetch } : {}),
      });
      const payload = deriveBrokerPayload(cfg, table);
      void brokerRef.publish(payload).then(() => brokerRef?.start());
    } else {
      log.debug("broker disabled: no broker_base_url");
    }
  } catch (err) {
    log.error("config load / VRM load failed:", err);
  }

  // 핫리로드: avatar manifest가 바뀌면 setManifest로 갱신 후 active VRM 핫스왑(#4 핫스왑).
  // override-wins: config vrm_url 편집은 사용자의 localStorage 선택을 덮지 않는다(agent-settings와 동일).
  config.subscribe((cfg, changed) => {
    // emotion/motion registry 핫리로드 → renderer 재주입(즉시 반영).
    if (changed.has("emotionRegistry")) renderer.setEmotionRegistry(cfg.emotionRegistry);
    if (changed.has("motions")) renderer.setMotionRegistry(cfg.motions);
    // irodori 화자 manifest 핫리로드 — synth가 다음 발화에서 getActive()로 읽으므로 재로드만 한다.
    if (changed.has("endpoints")) {
      speakerSelection.setManifest({
        available: cfg.endpoints.irodori_voices,
        defaultId: cfg.endpoints.irodori_speaker ?? "",
      });
    }
    // broker re-publish(D6): renderable vocab을 만드는 config 섹션이 바뀌면 동기화. best-effort.
    if (
      brokerRef &&
      (changed.has("emotionRegistry") || changed.has("motions") || changed.has("endpoints"))
    ) {
      void loadBrokerTable(cfg.endpoints.tts_provider).then((table) => {
        void brokerRef?.publish(deriveBrokerPayload(cfg, table));
      });
    }
    if (!changed.has("avatar")) return;
    // framing knob 핫리로드 (#106) — 핫스왑 재fit 전에 갱신.
    renderer.setFraming(cfg.avatar.framing ?? {});
    vrmSelection.setManifest({ available: cfg.avatar.available, defaultUrl: cfg.avatar.vrm_url });
    void loadVrmSerialized(vrmSelection.getActive().url).catch((err) =>
      log.error("VRM hot-swap failed:", err),
    );
  });
  config.onError((err) => log.error("config reload failed (이전 config 유지):", err));
  // dev에서만 폴링 watcher 가동 — configs/*.json 편집 시 즉시 반영. prod는 #27에서 결정.
  if (import.meta.env.DEV) {
    config.start();
    Object.assign(globalThis as Record<string, unknown>, { __yuiConfig: config });
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
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

void bootstrap();
