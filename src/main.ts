/**
 * YUI bootstrap.
 *
 * 최종 그래프 (concept.md §0, event-dispatcher.md §2):
 *   loadConfig() → createRenderer(mount) → createTier1Engine(renderer)
 *               → createEventBus() + createGuardrails()
 *               → createDispatcher({ bus, guardrails, renderer })
 *               → sources(timer/idle/user_input + Rust os_event) 구독 → dispatcher.start()
 *   io: streamChat(SSE) → express + 텍스트 스트림 → renderer / surfaces / tts-pipeline.
 *
 * 현재 = #4 renderer + UI surfaces 목업:
 *   - .yui-stage: 투명 캐릭터 무대(드래그 영역). renderer가 캔버스로 채운다.
 *   - .yui-ui:    오버레이 — 발화 말풍선·툴상태·텍스트 입력(invisible-by-default).
 *   실데이터(chat-client SSE / tts) 배선은 후속. 지금은 mock 드라이버가 surface를 구동한다.
 */

import "./styles.css";
import { createRenderer } from "./renderer";
import { createTier1Engine } from "./ambient/tier1";
import { createSurfaces } from "./ui/surfaces";
import { createMockDriver } from "./ui/mock";
import { createConfigStore, plainSecretProvider, CHAT_API_KEY_SECRET } from "./config";
import { initDrag } from "./drag";
import { selectFetch } from "./io/chat-client";
import { createEventBus } from "./dispatcher/event-bus";
import { createBackendCaller } from "./dispatcher/backend-caller";
import { createDispatcher, type Dispatcher } from "./dispatcher/dispatcher";
import { createUserInputSource } from "./dispatcher/user-input-source";

/** 입력 소환 핫키 (window-focus 한정 — 전역 단축키는 후속 tauri-plugin-global-shortcut). */
const SUMMON_KEY = "/";

async function bootstrap(): Promise<void> {
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

  // Register drag cleanup on HMR dispose in dev.
  if (import.meta.env.DEV) {
    import.meta.hot?.dispose(() => cleanupDrag());
  }

  const renderer = createRenderer({ mount: stage });
  // Tier 1 ambient(#10): backend 독립, 항상 ON. tick은 vrm 로드 후부터 발화하므로
  // loadVRM 전에 start해도 안전 (vrm 없는 프레임은 no-op).
  const ambient = createTier1Engine(renderer);
  ambient.start();
  const surfaces = createSurfaces({ mount: root });
  const mock = createMockDriver(surfaces);

  // ── Dispatcher spine (#21) ────────────────────────────────────────────────
  // event_bus → dispatcher → backend_caller → streamChat → Hermes → ControlEnvelope →
  // renderer.applyDirective. user.text_submitted가 이 루프를 구동한다.
  // bus/dispatcher는 config 로드 전에 만들어도 안전(엔드포인트는 backend_caller가 호출 시점에
  // config에서 읽는다). 다만 backend_caller는 config 스토어가 필요하므로 config 생성 후 배선한다.
  const bus = createEventBus({
    onDrop: (env, reason) =>
      console.info("[YUI][event_bus] drop", { event_name: env.event_name, reason }),
  });
  const userInput = createUserInputSource(bus);
  // dispatcher는 config 로드 후 생성되므로(backend_caller가 config.get()에 의존), dev 인스펙션
  // 핸들이 참조할 수 있게 forward holder를 둔다.
  let dispatcherRef: Dispatcher | null = null;

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
    console.warn("[YUI] VITE_YUI_CHAT_KEY 미설정 — chat은 무인증 placeholder로 호출돼 401 가능. .env.local 참고(.env.example).");
  }
  // backend_caller: config 스토어에서 endpoints/secret을 호출 시점에 읽고, transport fetch는
  // selectFetch()로 환경에 맞게 고른다(#44). speech_text는 말풍선으로(TTS는 #14 deferred).
  const backendCaller = createBackendCaller({
    // getter로 감싸 핫리로드된 endpoints를 다음 호출부터 반영(config.get()은 최신 스냅샷).
    get config() {
      return config.get().endpoints;
    },
    renderer,
    getApiKey: () => config.secrets.get(CHAT_API_KEY_SECRET),
    getFetch: () => selectFetch(),
    onSpeech: (text) => {
      surfaces.beginSpeech();
      surfaces.pushSpeech(text);
      surfaces.endSpeech();
    },
  });
  const dispatcher = createDispatcher({ bus, renderer, backendCaller });
  dispatcherRef = dispatcher;
  // HMR로 모듈이 재실행되면 이전 dispatcher의 setInterval/ in-flight가 남는다 → dispose에서 정지.
  if (import.meta.env.DEV) {
    import.meta.hot?.dispose(() => dispatcher.stop());
  }

  try {
    const cfg = await config.load();
    // emotion/motion registry를 renderer에 주입 → setEmotion/playMotion(=applyDirective) 동작.
    renderer.setEmotionRegistry(cfg.emotionRegistry);
    renderer.setMotionRegistry(cfg.motions);
    await renderer.loadVRM(cfg.avatar.vrm_url);
    // config가 준비된 후에만 dispatcher를 가동(backend_caller가 config.get()에 의존).
    dispatcher.start();
  } catch (err) {
    console.error("[YUI] config load / VRM load failed:", err);
  }

  // 핫리로드: avatar.vrm_url이 바뀌면 VRM 핫스왑(renderer.loadVRM 재호출 = #4 핫스왑).
  // loadVRM은 재진입 안전하지 않다(로드 완료 후 dispose+swap) → swap을 직렬화해 마지막
  // "시작"이 아니라 마지막 "config"가 이기게 한다(빠른 연속 편집 레이스 방지).
  let vrmSwap = Promise.resolve();
  config.subscribe((cfg, changed) => {
    // emotion/motion registry 핫리로드 → renderer 재주입(즉시 반영).
    if (changed.has("emotionRegistry")) renderer.setEmotionRegistry(cfg.emotionRegistry);
    if (changed.has("motions")) renderer.setMotionRegistry(cfg.motions);
    if (!changed.has("avatar")) return;
    vrmSwap = vrmSwap
      .then(() => renderer.loadVRM(cfg.avatar.vrm_url))
      .catch((err) => console.error("[YUI] VRM hot-swap failed:", err));
  });
  config.onError((err) => console.error("[YUI] config reload failed (이전 config 유지):", err));
  // dev에서만 폴링 watcher 가동 — configs/*.json 편집 시 즉시 반영. prod는 #27에서 결정.
  if (import.meta.env.DEV) {
    config.start();
    Object.assign(globalThis as Record<string, unknown>, { __yuiConfig: config });
    // HMR로 모듈이 재실행되면 이전 store의 setInterval이 쌓인다 → dispose에서 중지.
    import.meta.hot?.dispose(() => config.stop());
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
