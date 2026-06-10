/**
 * Tier 1 ambient — 순수 cue 수학.
 *
 * 여기 함수는 전부 **부수효과 없는 순수 함수**다 — VRM/DOM/시계에 의존하지 않는다.
 * 시간(ms/s)·rng를 받아 0..1 / -1..1 정규화 값을 돌려준다. 실제 bone/expression
 * 쓰기와 타이머는 tier1.ts(엔진)가 담당한다. → 단위 테스트(cues.test.ts) 대상.
 *
 * 진폭(라디안)은 엔진이 곱한다. 여기선 "모양"만 만든다.
 */

// ── 상수 (스펙) ──
export const BLINK_MIN_MS = 3000; // blink 평균 3~6초 랜덤
export const BLINK_MAX_MS = 6000;
export const BLINK_DURATION_MS = 150; // eye pulse 150ms
export const BREATH_PERIOD_S = 4; // 4s 주기
export const LOOK_MIN_MS = 30_000; // look_around 30~120s
export const LOOK_MAX_MS = 120_000;
export const TAP_BOB_MS = 220; // tap_react head bob ~200ms
export const IDLE_RETURNED_MS = 900; // idle_returned 살짝 위 시선

/** 결정성/테스트를 위해 rng 주입 가능 (기본 Math.random). */
export type Rng = () => number;

/** [min, max) 균등 난수. */
export function randRange(min: number, max: number, rng: Rng = Math.random): number {
  return min + (max - min) * rng();
}

/** 다음 blink까지의 지연(ms). BLINK_MIN_MS..BLINK_MAX_MS. */
export function nextBlinkDelay(rng: Rng = Math.random): number {
  return randRange(BLINK_MIN_MS, BLINK_MAX_MS, rng);
}

/** 다음 look_around까지의 지연(ms). LOOK_MIN_MS..LOOK_MAX_MS. */
export function nextLookDelay(rng: Rng = Math.random): number {
  return randRange(LOOK_MIN_MS, LOOK_MAX_MS, rng);
}

/**
 * blink 가중치 — blink 시작 후 경과 tMs를 받아 0..1(눈 감김 정도)을 반환.
 * 삼각 펄스: 0 → (중간)1 → 0. 구간 밖이면 0.
 */
export function blinkEnvelope(tMs: number): number {
  if (tMs <= 0 || tMs >= BLINK_DURATION_MS) return 0;
  const half = BLINK_DURATION_MS / 2;
  return tMs < half ? tMs / half : 1 - (tMs - half) / half;
}

/** breath sine — 경과 초를 받아 -1..1. period = BREATH_PERIOD_S. */
export function breathOffset(elapsedS: number): number {
  return Math.sin((elapsedS / BREATH_PERIOD_S) * Math.PI * 2);
}

/** idle_sway 정규화 성분(-1..1 대략). 무리수 비율 다주파 합성으로 비반복적 자연스러움. */
export interface SwayOffsets {
  headYaw: number;
  headPitch: number;
  headRoll: number;
  spinePitch: number;
}
export function swayOffsets(elapsedS: number): SwayOffsets {
  const t = elapsedS;
  return {
    headYaw: Math.sin(t * 0.37) * 0.6 + Math.sin(t * 0.13 + 1.1) * 0.4,
    headPitch: Math.sin(t * 0.27 + 1.3) * 0.6 + Math.sin(t * 0.11) * 0.4,
    headRoll: Math.sin(t * 0.21 + 0.5) * 0.5,
    spinePitch: Math.sin(t * 0.19 + 0.2) * 0.6,
  };
}

/**
 * 일회성 bob(끄덕임) 봉우리 — 0 → 1 → 0 단일 hump. 구간 밖이면 0.
 * tap_react/idle_returned에 재사용 (방향·진폭은 엔진이 결정).
 */
export function bobEnvelope(tMs: number, durationMs: number): number {
  if (tMs <= 0 || tMs >= durationMs) return 0;
  return Math.sin((tMs / durationMs) * Math.PI);
}

/**
 * 프레임률 독립 지수 댐핑 — current를 target 쪽으로 부드럽게 이동.
 * lambda 클수록 빠름. dt=초. (three-vrm lookat-advanced 예제와 동일한 1-exp(-k·dt) 방식)
 */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

/** look_around 목표 — 작은 yaw/pitch(라디안). 정면에서 과하지 않게. */
export interface LookTarget {
  yaw: number;
  pitch: number;
}
export function nextLookTarget(rng: Rng = Math.random): LookTarget {
  return {
    yaw: randRange(-0.3, 0.3, rng),
    pitch: randRange(-0.12, 0.12, rng),
  };
}
