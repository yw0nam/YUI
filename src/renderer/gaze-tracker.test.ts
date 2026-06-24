/**
 * gaze-tracker.test.ts — pure camera-gaze math (no three.js side effects, node env).
 *
 * Pins the 4-stage zone curve, target shaping (weight + clamp + eye-after-head
 * residual), exponential angle damping, and the head/neck split. Expected values
 * are hand-computed and pinned as literals, NOT recomputed via the helpers, so the
 * test independently fixes the contract.
 *
 * Reference cfg (the "natural" preset):
 *   deadDeg 3, headEngageDeg 20, disengageDeg 65,
 *   maxHeadYaw 50, maxHeadPitch 30, eyeMaxDeg 25, headNeckSplit 0.6, smooth 10
 * smoothstep(e0,e1,x): t = clamp((x-e0)/(e1-e0),0,1); t·t·(3-2t)
 *   smoothstep(3,20,11.5)  = 0.5   (midpoint ⇒ 0.5)
 *   smoothstep(20,65,42.5) = 0.5   (midpoint ⇒ 0.5)
 */

import { describe, expect, it } from "vitest";
import {
  clampDeg,
  dampAngle,
  type GazeConfig,
  gazeShape,
  gazeTargets,
  smoothstep,
  splitHeadNeck,
} from "./gaze-tracker";

const CFG: GazeConfig = {
  deadDeg: 3,
  headEngageDeg: 20,
  disengageDeg: 65,
  maxHeadYaw: 50,
  maxHeadPitch: 30,
  eyeMaxDeg: 25,
  headNeckSplit: 0.6,
  smooth: 10,
};

describe("smoothstep", () => {
  it("clamps below edge0 to 0 and above edge1 to 1", () => {
    expect(smoothstep(3, 20, 0)).toBe(0);
    expect(smoothstep(3, 20, 100)).toBe(1);
  });
  it("is 0.5 at the midpoint", () => {
    expect(smoothstep(3, 20, 11.5)).toBeCloseTo(0.5, 12);
    expect(smoothstep(20, 65, 42.5)).toBeCloseTo(0.5, 12);
  });
});

describe("clampDeg", () => {
  it("clamps symmetrically to ±max", () => {
    expect(clampDeg(10, 25)).toBe(10);
    expect(clampDeg(40, 25)).toBe(25);
    expect(clampDeg(-40, 25)).toBe(-25);
  });
});

describe("gazeShape — 4-stage zone curve", () => {
  it("dead zone (≤deadDeg) ⇒ no tracking", () => {
    expect(gazeShape(0, CFG)).toEqual({ eyeWeight: 0, headWeight: 0 });
    expect(gazeShape(3, CFG)).toEqual({ eyeWeight: 0, headWeight: 0 });
  });

  it("eyes-only band ⇒ eyeWeight ramps, headWeight stays 0", () => {
    const w = gazeShape(11.5, CFG);
    expect(w.eyeWeight).toBeCloseTo(0.5, 12);
    expect(w.headWeight).toBe(0);
  });

  it("at headEngageDeg ⇒ eyes full, head just starting (0)", () => {
    const w = gazeShape(20, CFG);
    expect(w.eyeWeight).toBeCloseTo(1, 12);
    expect(w.headWeight).toBe(0);
  });

  it("eyes+head band ⇒ eyes full, head ramps", () => {
    const w = gazeShape(42.5, CFG);
    expect(w.eyeWeight).toBeCloseTo(1, 12);
    expect(w.headWeight).toBeCloseTo(0.5, 12);
  });

  it("disengage (≥disengageDeg) ⇒ both 0", () => {
    expect(gazeShape(65, CFG)).toEqual({ eyeWeight: 0, headWeight: 0 });
    expect(gazeShape(90, CFG)).toEqual({ eyeWeight: 0, headWeight: 0 });
  });
});

describe("gazeTargets — weight + clamp + eye-after-head residual", () => {
  it("dead zone ⇒ all targets 0", () => {
    expect(gazeTargets(30, 10, 2, CFG)).toEqual({
      headYaw: 0,
      headPitch: 0,
      eyeYaw: 0,
      eyePitch: 0,
    });
  });

  it("eyes-only band ⇒ head still, eyes track the residual scaled by eyeWeight", () => {
    // ecc 11.5 ⇒ eyeWeight 0.5, headWeight 0. eyeYaw = clamp((11.5-0)*0.5) = 5.75
    const t = gazeTargets(11.5, 6, 11.5, CFG);
    expect(t.headYaw).toBe(0);
    expect(t.headPitch).toBe(0);
    expect(t.eyeYaw).toBeCloseTo(5.75, 10);
    expect(t.eyePitch).toBeCloseTo(3, 10);
  });

  it("eyes+head band ⇒ head takes its share, eyes close the remainder", () => {
    // ecc 42.5 ⇒ eyeWeight 1, headWeight 0.5. headYaw = 42.5*0.5 = 21.25;
    // eyeYaw = clamp((42.5-21.25)*1, 25) = 21.25
    const t = gazeTargets(42.5, 0, 42.5, CFG);
    expect(t.headYaw).toBeCloseTo(21.25, 10);
    expect(t.eyeYaw).toBeCloseTo(21.25, 10);
  });

  it("clamps head to ±maxHeadYaw and eyes to ±eyeMaxDeg", () => {
    // ecc 60 ⇒ headWeight = smoothstep(20,65,60). rYaw huge ⇒ both clamp.
    const t = gazeTargets(500, 500, 60, CFG);
    expect(t.headYaw).toBe(50);
    expect(t.headPitch).toBe(30);
    expect(t.eyeYaw).toBe(25);
    expect(t.eyePitch).toBe(25);
  });

  it("disengage ⇒ all targets 0 regardless of residual", () => {
    expect(gazeTargets(80, 40, 70, CFG)).toEqual({
      headYaw: 0,
      headPitch: 0,
      eyeYaw: 0,
      eyePitch: 0,
    });
  });
});

describe("dampAngle — exponential convergence", () => {
  it("k = 1-exp(-smooth·dt); one step moves prev toward target without overshoot", () => {
    // smooth 10, dt 0.016 ⇒ k = 1-exp(-0.16) = 0.147856...
    const next = dampAngle(0, 10, 10, 0.016);
    expect(next).toBeCloseTo(1.47856, 4);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(10);
  });

  it("monotonically converges over many steps", () => {
    let v = 0;
    let prev = -1;
    for (let i = 0; i < 200; i++) {
      v = dampAngle(v, 10, 10, 0.016);
      expect(v).toBeGreaterThan(prev); // strictly increasing toward target
      expect(v).toBeLessThanOrEqual(10);
      prev = v;
    }
    expect(v).toBeCloseTo(10, 5);
  });

  it("eases back to 0 when target is 0 (disengage path)", () => {
    let v = 30;
    for (let i = 0; i < 200; i++) v = dampAngle(v, 0, 10, 0.016);
    expect(v).toBeCloseTo(0, 5);
  });
});

describe("splitHeadNeck", () => {
  it("splits the total across head/neck by headNeckSplit when a neck exists", () => {
    expect(splitHeadNeck(20, 0.6, true)).toEqual({ head: 12, neck: 8 });
  });
  it("gives the whole rotation to the head when there is no neck bone", () => {
    expect(splitHeadNeck(20, 0.6, false)).toEqual({ head: 20, neck: 0 });
  });
});
