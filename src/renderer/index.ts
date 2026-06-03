/**
 * Renderer — three.js + @pixiv/three-vrm 출력 레이어. (placeholder, PRD F1 / concept.md §2.A)
 *
 * 책임(M1+):
 *  - VRM 모델 로드 + 핫스왑 (config로 모델 교체, alignment V7).
 *  - VRMA 모션 재생 (@pixiv/three-vrm-animation, contract.md §2 registry 해석).
 *  - emotion → VRM expression 전이 (configs/emotion_registry.json fallback 체인).
 *  - Tier 1 ambient(blink/idle sway/breath)와 backend motion의 additive blend
 *    (event-dispatcher.md §8 — 충돌 해소는 renderer 책임).
 *  - 진폭 기반 립싱크 (재생 wav 진폭 → mouth blendshape, contract.md §3 D-TTS-PIPELINE 7).
 *
 * 지금은 시그니처/타입만. 실제 three.js scene·VRMLoaderPlugin 배선은 M1.
 */

import type { ControlEnvelope, EmotionSignal, MotionSignal } from "../contract";

export interface RendererOptions {
  /** VRM을 렌더할 캔버스 마운트 대상. */
  mount: HTMLElement;
}

export interface Renderer {
  /** contract.md §3 렌더 규약대로 render directive를 적용 (emotion/motion/speech 등). */
  applyDirective(env: ControlEnvelope): void;
  /** emotion → expression 전이. 없으면 직전 표정 유지. */
  setEmotion(emotion: EmotionSignal | null): void;
  /** motion registry 조회 후 재생. null이면 idle 복귀. */
  playMotion(motion: MotionSignal | null): void;
  /** rAF 루프 정지 + GPU 리소스 해제. */
  dispose(): void;
}

/**
 * Renderer 인스턴스 생성 (placeholder).
 * TODO(M1): three.js scene/camera/renderer + VRMLoaderPlugin 구성, rAF 루프 시작.
 */
export function createRenderer(_options: RendererOptions): Renderer {
  // TODO(M1): three.js + three-vrm 초기화. 현재는 no-op stub.
  return {
    applyDirective(_env) {
      /* TODO(M1) */
    },
    setEmotion(_emotion) {
      /* TODO(M1) */
    },
    playMotion(_motion) {
      /* TODO(M1) */
    },
    dispose() {
      /* TODO(M1) */
    },
  };
}
