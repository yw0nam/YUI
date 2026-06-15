/**
 * recenter-root-motion.test.ts
 *
 * Encodes the contract for recentering a VRMA hips position track so
 * the pet stays centered while keeping its weight-shift sway balanced on origin.
 *
 * Conventions:
 *  - Flat [x,y,z, x,y,z, ...] buffers matching createVRMAnimationClip output.
 *  - X and Z are recentered around their own mean; Y is left untouched.
 */

import { describe, expect, it } from "vitest";
import { recenterRootTranslation } from "./recenter-root-motion";

describe("recenterRootTranslation — horizontal mean removal", () => {
  it("subtracts mean of all X and all Z samples; leaves Y unchanged", () => {
    // X: [1,3] meanX=2 → [-1,1]; Z: [3,7] meanZ=5 → [-2,2]; Y untouched.
    const result = recenterRootTranslation([1, 5, 3, 3, 7, 7]);
    expect(Array.from(result)).toEqual([-1, 5, -2, 1, 7, 2]);
  });

  it("returns an already zero-mean buffer essentially unchanged", () => {
    const input = [-1, 5, -2, 1, 7, 2];
    const result = recenterRootTranslation(input);
    expect(result[0]).toBeCloseTo(-1);
    expect(result[1]).toBeCloseTo(5);
    expect(result[2]).toBeCloseTo(-2);
    expect(result[3]).toBeCloseTo(1);
    expect(result[4]).toBeCloseTo(7);
    expect(result[5]).toBeCloseTo(2);
  });

  it("single keyframe [a,b,c] → [0,b,0]", () => {
    const result = recenterRootTranslation([0.45, 1.1, -0.2]);
    expect(result[0]).toBeCloseTo(0);
    expect(result[1]).toBeCloseTo(1.1);
    expect(result[2]).toBeCloseTo(0);
  });

  it("length not a multiple of 3 → returns a copy unchanged (defensive)", () => {
    const input = [1, 2, 3, 4];
    const result = recenterRootTranslation(input);
    expect(Array.from(result)).toEqual([1, 2, 3, 4]);
  });

  it("does not mutate the input array", () => {
    const input = [1, 5, 3, 3, 7, 7];
    const snapshot = [...input];
    recenterRootTranslation(input);
    expect(input).toEqual(snapshot);
  });

  it("returns a Float32Array", () => {
    const result = recenterRootTranslation([1, 5, 3, 3, 7, 7]);
    expect(result).toBeInstanceOf(Float32Array);
  });
});
