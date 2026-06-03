/**
 * Tier 1 ambient engine — blink / idle sway / breath 등 로컬 생동감. (placeholder, PRD F5 / event-dispatcher.md §8)
 *
 * 항상 켜짐, **backend 독립**(네트워크 X). 렌더 루프(rAF) hook으로 동작하며 backend motion과
 * additive blend (BlendShape 채널 분리 또는 weight 합성 — 충돌 해소는 renderer 책임).
 *
 * Cue 표 (event-dispatcher.md §8):
 *  - blink           : 평균 4s ± 2s, eye BlendShape pulse 150ms
 *  - idle_sway       : 항상, spring bone + sine (head/hip)
 *  - breath          : 4s 주기, chest BlendShape sine
 *  - look_around     : 30~120s 무작위, head bone target shift
 *  - tap_react       : user.tap 시 1회, head bob 200ms
 *  - idle_returned   : idle.returned 1회, 살짝 위 시선
 *
 * 지금은 시그니처만. 실제 rAF cue 구현은 M1.
 */

import type { Renderer } from "../renderer";

export type AmbientCue =
  | "blink"
  | "idle_sway"
  | "breath"
  | "look_around"
  | "tap_react"
  | "idle_returned";

export interface Tier1Engine {
  /** rAF hook 등록 + 주기 cue 시작. */
  start(): void;
  /** 일회성 cue 트리거 (tap_react / idle_returned 등 dispatcher tier1 라우팅). */
  trigger(cue: AmbientCue): void;
  /** rAF hook 해제. */
  stop(): void;
}

/**
 * Tier1 ambient engine 생성 (placeholder).
 * TODO(M1): blink/breath 타이머 + idle_sway sine + renderer BlendShape 합성.
 */
export function createTier1Engine(_renderer: Renderer): Tier1Engine {
  return {
    start() {
      /* TODO(M1) */
    },
    trigger(_cue) {
      /* TODO(M1) */
    },
    stop() {
      /* TODO(M1) */
    },
  };
}
