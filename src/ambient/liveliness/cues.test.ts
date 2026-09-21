import { describe, expect, it } from "vitest";
import {
  BLINK_DURATION_MS,
  BLINK_MAX_MS,
  BLINK_MIN_MS,
  BREATH_PERIOD_S,
  blinkEnvelope,
  bobEnvelope,
  breathOffset,
  damp,
  LOOK_MAX_MS,
  LOOK_MIN_MS,
  nextBlinkDelay,
  nextLookDelay,
  nextLookTarget,
  type Rng,
  swayOffsets,
  TAP_BOB_MS,
} from "./cues";

/** Deterministic rng sequence (for tests). */
const seq = (values: number[]): Rng => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe("ambient/cues — blink", () => {
  it("nextBlinkDelay stays within [MIN, MAX) for the rng range", () => {
    expect(nextBlinkDelay(() => 0)).toBe(BLINK_MIN_MS);
    expect(nextBlinkDelay(() => 0.5)).toBeCloseTo((BLINK_MIN_MS + BLINK_MAX_MS) / 2);
    expect(nextBlinkDelay(() => 0.999)).toBeLessThan(BLINK_MAX_MS);
    expect(nextBlinkDelay(() => 0.999)).toBeGreaterThanOrEqual(BLINK_MIN_MS);
  });

  it("blinkEnvelope is a 0→1→0 triangular pulse, 0 outside the window", () => {
    expect(blinkEnvelope(-5)).toBe(0);
    expect(blinkEnvelope(0)).toBe(0);
    expect(blinkEnvelope(BLINK_DURATION_MS / 2)).toBeCloseTo(1); // peak (eyes shut)
    expect(blinkEnvelope(BLINK_DURATION_MS)).toBe(0);
    expect(blinkEnvelope(BLINK_DURATION_MS + 50)).toBe(0);
  });

  it("blinkEnvelope is symmetric around the midpoint", () => {
    const a = blinkEnvelope(BLINK_DURATION_MS * 0.25);
    const b = blinkEnvelope(BLINK_DURATION_MS * 0.75);
    expect(a).toBeCloseTo(b);
    expect(a).toBeCloseTo(0.5);
  });
});

describe("ambient/cues — breath", () => {
  it("is a sine: 0 at t=0, peak at quarter period, back to 0 at half/full period", () => {
    expect(breathOffset(0)).toBeCloseTo(0);
    expect(breathOffset(BREATH_PERIOD_S / 4)).toBeCloseTo(1);
    expect(breathOffset(BREATH_PERIOD_S * (3 / 4))).toBeCloseTo(-1);
    expect(breathOffset(BREATH_PERIOD_S)).toBeCloseTo(0);
  });

  it("is periodic with BREATH_PERIOD_S", () => {
    expect(breathOffset(1.234)).toBeCloseTo(breathOffset(1.234 + BREATH_PERIOD_S));
  });
});

describe("ambient/cues — sway", () => {
  it("stays within a bounded normalized range (|·| ≤ 1) across a long span", () => {
    for (let t = 0; t < 600; t += 0.37) {
      const s = swayOffsets(t);
      for (const v of [s.headYaw, s.headPitch, s.headRoll, s.spinePitch]) {
        expect(Math.abs(v)).toBeLessThanOrEqual(1.0001);
      }
    }
  });

  it("is non-static (changes over time → alive, not frozen)", () => {
    const a = swayOffsets(0);
    const b = swayOffsets(2.5);
    expect(a.headYaw).not.toBeCloseTo(b.headYaw);
  });
});

describe("ambient/cues — one-shot bob", () => {
  it("is a single 0→1→0 hump, 0 outside the window", () => {
    expect(bobEnvelope(-1, TAP_BOB_MS)).toBe(0);
    expect(bobEnvelope(0, TAP_BOB_MS)).toBe(0);
    expect(bobEnvelope(TAP_BOB_MS / 2, TAP_BOB_MS)).toBeCloseTo(1);
    expect(bobEnvelope(TAP_BOB_MS, TAP_BOB_MS)).toBe(0);
    expect(bobEnvelope(TAP_BOB_MS + 1, TAP_BOB_MS)).toBe(0);
  });
});

describe("ambient/cues — damp", () => {
  it("moves toward the target and converges (frame-rate independent)", () => {
    let x = 0;
    for (let i = 0; i < 200; i++) x = damp(x, 1, 5, 1 / 60);
    expect(x).toBeCloseTo(1, 2);
  });

  it("is monotonic toward the target and never overshoots", () => {
    let x = 0;
    let prev = -Infinity;
    for (let i = 0; i < 100; i++) {
      x = damp(x, 1, 5, 1 / 60);
      expect(x).toBeGreaterThan(prev);
      expect(x).toBeLessThanOrEqual(1);
      prev = x;
    }
  });
});

describe("ambient/cues — look-around", () => {
  it("nextLookDelay within [MIN, MAX)", () => {
    expect(nextLookDelay(() => 0)).toBe(LOOK_MIN_MS);
    expect(nextLookDelay(() => 0.999)).toBeLessThan(LOOK_MAX_MS);
  });

  it("nextLookTarget yields small, bounded yaw/pitch", () => {
    const t = nextLookTarget(seq([0, 1])); // extremes
    expect(Math.abs(t.yaw)).toBeLessThanOrEqual(0.3);
    expect(Math.abs(t.pitch)).toBeLessThanOrEqual(0.12);
  });
});
