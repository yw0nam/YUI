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

  // TODO(M1): 위 주석의 그래프 조립. 현재는 #7 투명창 시각 검증 타깃.
  // 패널 바깥은 완전 투명 → 데스크톱 위에 둥근 카드만 떠 보이면 투명/무테 정상.
  // data-tauri-drag-region: 무테 창은 타이틀바가 없으므로 이 영역을 잡아 창을 옮긴다
  // (전체 드래그 이동 + 멀티모니터 DPI는 #9에서). 카드 자체가 always-on-top 검증 대상.
  app.innerHTML = `
    <main class="yui-stage">
      <section class="yui-card" data-tauri-drag-region>
        <div class="yui-silhouette" aria-hidden="true"></div>
        <h1>YUI</h1>
        <p>#7 transparent window — 카드 바깥이 비치면 OK. 드래그해서 이동.</p>
      </section>
    </main>
  `;
}

bootstrap();
