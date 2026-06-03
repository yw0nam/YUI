/**
 * YUI bootstrap. (placeholder, 실제 부트 로직 M1)
 *
 * M1에서 이 파일이 조립할 그래프 (concept.md §0, event-dispatcher.md §2):
 *   loadConfig() → createRenderer(mount) → createTier1Engine(renderer)
 *               → createEventBus() + createGuardrails()
 *               → createDispatcher({ bus, guardrails, renderer })
 *               → sources(timer/idle/user_input + Rust os_event) 구독 → dispatcher.start()
 *   io: streamChat(SSE) → express + 텍스트 스트림 → renderer / tts-pipeline.
 *
 * 지금은 마운트 포인트 확인 + placeholder 배너만. 무거운 초기화는 하지 않는다.
 */

import "./styles.css";

function bootstrap(): void {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) {
    throw new Error("#app mount point not found");
  }

  // TODO(M1): 위 주석의 그래프 조립. 현재는 scaffold 상태 표시만.
  app.innerHTML = `
    <main class="yui-scaffold">
      <h1>YUI</h1>
      <p>Phase C scaffold — renderer / dispatcher / io 모듈은 M1에서 구현.</p>
    </main>
  `;
}

bootstrap();
