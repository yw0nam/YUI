/**
 * Tier 1 ambient — pure cue math.
 *
 * Every function here is a **side-effect-free pure function** — no dependency on VRM/DOM/clock.
 * Given time (ms/s) and rng, they return normalized 0..1 / -1..1 values. Actual bone/expression
 * writes and timers are handled by tier1.ts (the engine). → unit-test target (cues.test.ts).
 *
 * Amplitude (radians) is multiplied in by the engine. Here we only produce the "shape".
 */

// ── Constants (spec) ──
export const BLINK_MIN_MS = 3000; // blink averages a random 3~6s
export const BLINK_MAX_MS = 6000;
export const BLINK_DURATION_MS = 150; // eye pulse 150ms
export const BREATH_PERIOD_S = 4; // 4s period
export const LOOK_MIN_MS = 30_000; // look_around 30~120s
export const LOOK_MAX_MS = 120_000;
export const TAP_BOB_MS = 220; // tap_react head bob ~200ms
export const IDLE_RETURNED_MS = 900; // idle_returned slight upward gaze

/** rng is injectable for determinism/testing (defaults to Math.random). */
export type Rng = () => number;

/** Uniform random in [min, max). */
export function randRange(min: number, max: number, rng: Rng = Math.random): number {
  return min + (max - min) * rng();
}

/** Delay (ms) until the next blink. BLINK_MIN_MS..BLINK_MAX_MS. */
export function nextBlinkDelay(rng: Rng = Math.random): number {
  return randRange(BLINK_MIN_MS, BLINK_MAX_MS, rng);
}

/** Delay (ms) until the next look_around. LOOK_MIN_MS..LOOK_MAX_MS. */
export function nextLookDelay(rng: Rng = Math.random): number {
  return randRange(LOOK_MIN_MS, LOOK_MAX_MS, rng);
}

/**
 * blink weight — given tMs elapsed since blink start, returns 0..1 (eye-closed amount).
 * Triangular pulse: 0 → (midpoint)1 → 0. 0 outside the window.
 */
export function blinkEnvelope(tMs: number): number {
  if (tMs <= 0 || tMs >= BLINK_DURATION_MS) return 0;
  const half = BLINK_DURATION_MS / 2;
  return tMs < half ? tMs / half : 1 - (tMs - half) / half;
}

/** breath sine — given elapsed seconds, returns -1..1. period = BREATH_PERIOD_S. */
export function breathOffset(elapsedS: number): number {
  return Math.sin((elapsedS / BREATH_PERIOD_S) * Math.PI * 2);
}

/** Normalized idle_sway components (roughly -1..1). Irrational-ratio multi-frequency mix for non-repeating naturalness. */
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
 * One-shot bob (nod) peak — a single 0 → 1 → 0 hump. 0 outside the window.
 * Reused for tap_react/idle_returned (direction and amplitude decided by the engine).
 */
export function bobEnvelope(tMs: number, durationMs: number): number {
  if (tMs <= 0 || tMs >= durationMs) return 0;
  return Math.sin((tMs / durationMs) * Math.PI);
}

/**
 * Frame-rate-independent exponential damping — smoothly moves current toward target.
 * Larger lambda is faster. dt=seconds. (Same 1-exp(-k·dt) approach as the three-vrm lookat-advanced example.)
 */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

/** look_around target — small yaw/pitch (radians). Kept modest around front-facing. */
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
