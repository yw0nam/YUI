/**
 * YUI bootstrap.
 *
 * 최종 그래프 (concept.md §0, event-dispatcher.md §2):
 *   loadConfig() → createRenderer(mount) → createTier1Engine(renderer)
 *               → createEventBus() + createGuardrails()
 *               → createDispatcher({ bus, guardrails, renderer })
 *               → sources(timer/idle/user_input + Rust os_event) 구독 → dispatcher.start()
 *   io: streamChat(SSE) → express + 텍스트 스트림 → renderer / tts-pipeline.
 *
 * 현재 = #4: renderer 마운트 + config의 VRM 로드. 나머지 배선은 후속 이슈.
 */

import "./styles.css";
import { createRenderer } from "./renderer";

interface AvatarConfig {
  vrm_url: string;
}

async function bootstrap(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) {
    throw new Error("#app mount point not found");
  }

  // 전체 영역 = 투명 무대 + 드래그 영역(무테 창 이동, #7). 캐릭터는 캔버스로 채운다.
  // 정밀 per-region hit-test는 #8/#9.
  app.innerHTML = `<div class="yui-stage" data-tauri-drag-region></div>`;
  const stage = app.querySelector<HTMLDivElement>(".yui-stage")!;

  const renderer = createRenderer({ mount: stage });

  // dev 전용: 스크린샷 검증 루프(#12)에서 핫스왑 등을 호출할 수 있게 핸들 노출.
  if (import.meta.env.DEV) {
    (globalThis as Record<string, unknown>).__yuiRenderer = renderer;
  }

  // config-driven VRM 경로 (#4). 전체 config 로더 + 핫리로드는 #8.
  try {
    const cfg = (await fetch("/configs/avatar.json").then((r) => r.json())) as AvatarConfig;
    await renderer.loadVRM(cfg.vrm_url);
  } catch (err) {
    console.error("[YUI] VRM load failed:", err);
  }
}

void bootstrap();
