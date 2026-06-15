/**
 * lipsync.test.ts — amplitude-based mouth lip sync.
 *
 * Amplitude only — NO phoneme/viseme (viseme is P2, out of scope for MVP).
 *
 * The renderer owns ONLY the `aa` mouth preset (renderer/index.ts line ~363:
 * "blink/blinkLeft/blinkRight/lookAt/mouth keys are owned by ambient/lipsync —
 * never touched by emotion/motion"). These tests pin the pure mouth state machine
 * that `Renderer.setMouthOpen` drives, exercised against a fake expressionManager
 * (no WebGL / no real VRM):
 *
 *  - setMouthOpen clamps to [0,1].
 *  - step() writes ONLY the `aa` expression weight, smoothed (lerp) toward target.
 *  - stop() eases the mouth back to 0.
 *  - it never touches blink / lookAt / emotion keys.
 */

import { describe, expect, it, vi } from "vitest";
import { createMouthLipsync, MOUTH_EXPRESSION_KEY } from "./index";

/** Minimal expressionManager stub: records setValue calls; `aa` exists by default. */
function fakeExpressionManager(opts: { hasAa?: boolean } = {}) {
  const hasAa = opts.hasAa ?? true;
  const setValue = vi.fn<(name: string, weight: number) => void>();
  const em = {
    setValue,
    getExpression: (name: string) => (name === "aa" && hasAa ? {} : null),
  };
  return { em, setValue };
}

/** Latest weight written for a given key, or undefined if never written. */
function lastWeight(setValue: ReturnType<typeof vi.fn>, key: string): number | undefined {
  const calls = setValue.mock.calls.filter((c) => c[0] === key);
  return calls.length ? (calls[calls.length - 1][1] as number) : undefined;
}

describe("createMouthLipsync — clamping", () => {
  it("clamps setOpen above 1 down to 1", () => {
    const mouth = createMouthLipsync({ smoothing: 1 }); // smoothing 1 = snap to target
    const { em, setValue } = fakeExpressionManager();
    mouth.setOpen(5);
    mouth.step(0.016, em);
    expect(lastWeight(setValue, "aa")).toBe(1);
  });

  it("clamps setOpen below 0 up to 0", () => {
    const mouth = createMouthLipsync({ smoothing: 1 });
    const { em, setValue } = fakeExpressionManager();
    mouth.setOpen(-3);
    mouth.step(0.016, em);
    expect(lastWeight(setValue, "aa")).toBe(0);
  });

  it("passes a mid value through (0.5 → 0.5 with snap smoothing)", () => {
    const mouth = createMouthLipsync({ smoothing: 1 });
    const { em, setValue } = fakeExpressionManager();
    mouth.setOpen(0.5);
    mouth.step(0.016, em);
    expect(lastWeight(setValue, "aa")).toBeCloseTo(0.5, 5);
  });
});

describe("createMouthLipsync — writes only the mouth key", () => {
  it("writes the `aa` preset and nothing else", () => {
    const mouth = createMouthLipsync({ smoothing: 1 });
    const { em, setValue } = fakeExpressionManager();
    mouth.setOpen(0.7);
    mouth.step(0.016, em);

    expect(MOUTH_EXPRESSION_KEY).toBe("aa");
    const keys = new Set(setValue.mock.calls.map((c) => c[0]));
    expect(keys).toEqual(new Set(["aa"]));
  });

  it("never touches blink / lookAt / emotion keys across many steps", () => {
    const mouth = createMouthLipsync({ smoothing: 0.3 });
    const { em, setValue } = fakeExpressionManager();
    const FORBIDDEN = [
      "blink",
      "blinkLeft",
      "blinkRight",
      "lookUp",
      "lookDown",
      "lookLeft",
      "lookRight",
      "happy",
      "angry",
      "sad",
      "relaxed",
      "neutral",
    ];
    for (const v of [0.1, 0.9, 0.4, 0.0, 0.6]) {
      mouth.setOpen(v);
      for (let i = 0; i < 5; i++) mouth.step(0.016, em);
    }
    const written = new Set(setValue.mock.calls.map((c) => c[0]));
    for (const k of FORBIDDEN) expect(written.has(k)).toBe(false);
  });

  it("no-ops safely when the model lacks an `aa` expression (never throws, never writes)", () => {
    const mouth = createMouthLipsync({ smoothing: 1 });
    const { em, setValue } = fakeExpressionManager({ hasAa: false });
    mouth.setOpen(0.8);
    expect(() => mouth.step(0.016, em)).not.toThrow();
    expect(setValue).not.toHaveBeenCalled();
  });
});

describe("createMouthLipsync — smoothing (lerp toward target)", () => {
  it("does not jump instantly to target with smoothing < 1", () => {
    const mouth = createMouthLipsync({ smoothing: 0.25 });
    const { em, setValue } = fakeExpressionManager();
    mouth.setOpen(1);
    mouth.step(0.016, em);
    const w = lastWeight(setValue, "aa")!;
    expect(w).toBeGreaterThan(0);
    expect(w).toBeLessThan(1); // partway, not snapped
  });

  it("converges toward the target over successive steps", () => {
    const mouth = createMouthLipsync({ smoothing: 0.3 });
    const { em, setValue } = fakeExpressionManager();
    mouth.setOpen(1);
    let prev = -1;
    for (let i = 0; i < 30; i++) {
      mouth.step(0.016, em);
      const w = lastWeight(setValue, "aa")!;
      expect(w).toBeGreaterThanOrEqual(prev); // monotonic rise toward 1
      prev = w;
    }
    expect(prev).toBeGreaterThan(0.95); // effectively reached target
  });
});

describe("createMouthLipsync — stop eases mouth back to 0", () => {
  it("targets 0 after stop() and the mouth closes", () => {
    const mouth = createMouthLipsync({ smoothing: 0.4 });
    const { em, setValue } = fakeExpressionManager();
    // open the mouth first
    mouth.setOpen(1);
    for (let i = 0; i < 30; i++) mouth.step(0.016, em);
    expect(lastWeight(setValue, "aa")!).toBeGreaterThan(0.9);

    // stop → ease back to 0
    mouth.stop();
    for (let i = 0; i < 40; i++) mouth.step(0.016, em);
    expect(lastWeight(setValue, "aa")!).toBeLessThan(0.05);
  });

  it("reaches exactly 0 with snap smoothing after stop()", () => {
    const mouth = createMouthLipsync({ smoothing: 1 });
    const { em, setValue } = fakeExpressionManager();
    mouth.setOpen(1);
    mouth.step(0.016, em);
    mouth.stop();
    mouth.step(0.016, em);
    expect(lastWeight(setValue, "aa")).toBe(0);
  });
});
