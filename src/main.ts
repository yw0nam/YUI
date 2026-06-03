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
import { createSurfaces } from "./ui/surfaces";
import { createMockDriver } from "./ui/mock";

interface AvatarConfig {
  vrm_url: string;
}

/** 입력 소환 핫키 (window-focus 한정 — 전역 단축키는 후속 tauri-plugin-global-shortcut). */
const SUMMON_KEY = "/";

async function bootstrap(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) {
    throw new Error("#app mount point not found");
  }

  // 루트(포지셔닝 컨텍스트) > 무대(드래그) + 오버레이(surfaces).
  // 정밀 per-region hit-test는 #8/#9. 지금은 무대 = 드래그, 오버레이 = pointer 통과(입력만 예외).
  app.innerHTML = `
    <div class="yui-root">
      <div class="yui-stage" data-tauri-drag-region></div>
    </div>
  `;
  const root = app.querySelector<HTMLDivElement>(".yui-root")!;
  const stage = root.querySelector<HTMLDivElement>(".yui-stage")!;

  const renderer = createRenderer({ mount: stage });
  const surfaces = createSurfaces({ mount: root });
  const mock = createMockDriver(surfaces);

  // 제출 → 입력 닫고 응답 재생(목업). 실배선에선 chat-client.streamChat로 교체.
  surfaces.onSubmit((text) => {
    surfaces.dismissInput();
    void mock.reply(text);
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
      __yuiSurfaces: surfaces,
      __yuiMock: mock,
      // 단계별 시연 헬퍼
      __yuiDemo: {
        input: () => surfaces.summonInput(),
        tool: (label = "검색 중…") => surfaces.showTool(label),
        reply: (text = "오늘 일정 뭐 있어?") => mock.reply(text),
        proactive: () => mock.proactive(),
        speak: (line = "응, 듣고 있어. 그거 지금 같이 볼까?") => mock.speak(line),
      },
    });
  }

  // config-driven VRM 경로 (#4). 전체 config 로더 + 핫리로드는 #8.
  try {
    const cfg = (await fetch("/configs/avatar.json").then((r) => r.json())) as AvatarConfig;
    await renderer.loadVRM(cfg.vrm_url);
  } catch (err) {
    console.error("[YUI] VRM load failed:", err);
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
