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

import { AnimationClip, QuaternionKeyframeTrack, VectorKeyframeTrack } from "three";
import { describe, expect, it } from "vitest";
import {
  detrendClipRootY,
  detrendRootY,
  recenterRootTranslation,
  rootYCurve,
  sampleRootYCurve,
} from "./recenter-root-motion";

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

describe("detrendRootY — vertical travel removal", () => {
  it("removes the end-to-end rise linearly and reports it", () => {
    // y 1.0 → 2.0 over 2 s, bobbing 0.1 above the line at the midpoint.
    const { values, travel } = detrendRootY([0, 1, 2], [0, 1.0, 0, 0, 1.6, 0, 0, 2.0, 0]);
    expect(travel).toBeCloseTo(1.0, 6);
    expect(values[1]).toBeCloseTo(1.0, 6);
    expect(values[4]).toBeCloseTo(1.1, 6);
    expect(values[7]).toBeCloseTo(1.0, 6);
  });

  it("closes the loop seam — the last key lands back on the first", () => {
    const { values } = detrendRootY([0, 0.5, 1.5, 2], [0, 1.0, 0, 0, 1.9, 0, 0, 1.2, 0, 0, 2.0, 0]);
    expect(values[10]).toBeCloseTo(values[1], 6);
  });

  it("keeps the bob, measuring it against the line rather than the first key", () => {
    // Same rise, but the midpoint dips 0.1 BELOW the line — the dip has to survive.
    const { values } = detrendRootY([0, 1, 2], [0, 1.0, 0, 0, 1.4, 0, 0, 2.0, 0]);
    expect(values[4]).toBeCloseTo(0.9, 6);
  });

  it("handles a descent, reporting the travel signed", () => {
    const { values, travel } = detrendRootY([0, 1, 2], [0, 2.0, 0, 0, 1.4, 0, 0, 1.0, 0]);
    expect(travel).toBeCloseTo(-1.0, 6);
    expect(values[7]).toBeCloseTo(values[1], 6);
    expect(values[4]).toBeCloseTo(1.9, 6);
  });

  it("leaves X and Z alone", () => {
    const { values } = detrendRootY([0, 1], [1, 1.0, 3, 5, 2.0, 7]);
    expect(values[0]).toBeCloseTo(1, 6);
    expect(values[2]).toBeCloseTo(3, 6);
    expect(values[3]).toBeCloseTo(5, 6);
    expect(values[5]).toBeCloseTo(7, 6);
  });

  it("reports no travel for a track that already ends where it started", () => {
    const { values, travel } = detrendRootY([0, 1, 2], [0, 1.0, 0, 0, 1.5, 0, 0, 1.0, 0]);
    expect(travel).toBe(0);
    expect(values[4]).toBeCloseTo(1.5, 6);
  });

  it.each([
    ["a single keyframe", [0], [0, 1.1, 0]],
    ["a length that is not a multiple of 3", [0, 1], [1, 2, 3, 4]],
    ["no keyframes", [], []],
  ])("returns a copy with no travel for %s", (_label, times, values) => {
    const result = detrendRootY(times, values);
    expect(result.travel).toBe(0);
    expect(result.values).toHaveLength(values.length);
    // Float32 storage, so compare within its precision rather than exactly.
    for (const [i, v] of values.entries()) expect(result.values[i]).toBeCloseTo(v, 6);
  });

  it("does not mutate the input", () => {
    const input = [0, 1.0, 0, 0, 2.0, 0];
    const snapshot = [...input];
    detrendRootY([0, 1], input);
    expect(input).toEqual(snapshot);
  });
});

describe("detrendRootY — resting the hips at their own height", () => {
  it("drops a clip that starts far above the rest pose down onto it", () => {
    // climb_down opens with the hips at 1.9 m; standing rest is 0.95, so without this
    // the whole clip plays a metre up the canvas and the head leaves the window.
    const { values, shift } = detrendRootY([0, 1], [0, 1.9, 0, 0, 1.9, 0], 0.95);
    expect(values[1]).toBeCloseTo(0.95, 6);
    expect(values[4]).toBeCloseTo(0.95, 6);
    expect(shift).toBeCloseTo(-0.95, 6);
  });

  it("leaves a clip that already starts at the rest height alone", () => {
    const { values, shift } = detrendRootY([0, 1], [0, 0.95, 0, 0, 1.05, 0], 0.95);
    expect(shift).toBe(0);
    expect(values[1]).toBeCloseTo(0.95, 6);
    expect(values[4]).toBeCloseTo(1.05, 6);
  });

  it("anchors the detrended track, not the raw one", () => {
    // Rise 1.0 removed first, then the start dropped from 1.9 to 0.95.
    const { values, travel, shift } = detrendRootY(
      [0, 1, 2],
      [0, 1.9, 0, 0, 2.5, 0, 0, 2.9, 0],
      0.95,
    );
    expect(travel).toBeCloseTo(1.0, 6);
    expect(shift).toBeCloseTo(-0.95, 6);
    expect(values[1]).toBeCloseTo(0.95, 6);
    expect(values[4]).toBeCloseTo(1.05, 6);
    expect(values[7]).toBeCloseTo(0.95, 6);
  });

  it("reports no shift when no rest height is given", () => {
    expect(detrendRootY([0, 1], [0, 1.9, 0, 0, 1.9, 0]).shift).toBe(0);
  });
});

describe("rootYCurve / sampleRootYCurve", () => {
  const curve = { times: [0, 1, 2], values: [0, 0.8, 1.0] };

  it("reads the clip's own rise from its first key", () => {
    expect(rootYCurve([0, 1, 2], [0, 1.9, 0, 0, 2.7, 0, 0, 2.9, 0])).toEqual(curve);
  });

  it("interpolates linearly between keys", () => {
    expect(sampleRootYCurve(curve, 0)).toBeCloseTo(0, 6);
    expect(sampleRootYCurve(curve, 0.5)).toBeCloseTo(0.4, 6);
    expect(sampleRootYCurve(curve, 1)).toBeCloseTo(0.8, 6);
    expect(sampleRootYCurve(curve, 1.5)).toBeCloseTo(0.9, 6);
    expect(sampleRootYCurve(curve, 2)).toBeCloseTo(1.0, 6);
  });

  it("clamps outside the clip's own span", () => {
    expect(sampleRootYCurve(curve, -1)).toBeCloseTo(0, 6);
    expect(sampleRootYCurve(curve, 5)).toBeCloseTo(1.0, 6);
  });

  it("keeps a descent signed negative", () => {
    const down = rootYCurve([0, 1], [0, 1.9, 0, 0, 0.9, 0]);
    expect(down?.values).toEqual([0, -1]);
    expect(sampleRootYCurve(down!, 0.5)).toBeCloseTo(-0.5, 6);
  });

  it("returns null for a track with nothing to follow", () => {
    expect(rootYCurve([0], [0, 1.9, 0])).toBeNull();
    expect(rootYCurve([0, 1], [1, 2, 3, 4])).toBeNull();
  });
});

describe("detrendClipRootY", () => {
  it("detrends every position track in place and reports the travel removed", () => {
    const clip = new AnimationClip("climb_up", 2, [
      new VectorKeyframeTrack("hips.position", [0, 1, 2], [0, 1.0, 0, 0, 1.6, 0, 0, 2.0, 0]),
      new QuaternionKeyframeTrack("hips.quaternion", [0, 2], [0, 0, 0, 1, 0, 0, 0, 1]),
    ]);

    const { travel } = detrendClipRootY(clip);

    expect(travel).toBeCloseTo(1.0, 6);
    const position = clip.tracks[0];
    expect(position.values[1]).toBeCloseTo(1.0, 6);
    expect(position.values[4]).toBeCloseTo(1.1, 6);
    expect(position.values[7]).toBeCloseTo(1.0, 6);
    // The rotation track is untouched.
    expect(Array.from(clip.tracks[1].values)).toEqual([0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it("keeps the removed curve so a mover can follow it instead of guessing", () => {
    const clip = new AnimationClip("climb_up", 2, [
      new VectorKeyframeTrack("hips.position", [0, 1, 2], [0, 1.0, 0, 0, 1.6, 0, 0, 2.0, 0]),
    ]);
    const { curve } = detrendClipRootY(clip);
    expect(curve).toEqual({ times: [0, 1, 2], values: [0, 0.6, 1.0] });
  });

  it("rests the hips at the height it is given", () => {
    const clip = new AnimationClip("climb_down", 2, [
      new VectorKeyframeTrack("hips.position", [0, 2], [0, 1.9, 0, 0, 0.9, 0]),
    ]);
    const { shift } = detrendClipRootY(clip, 0.95);
    expect(shift).toBeCloseTo(-0.95, 6);
    expect(clip.tracks[0].values[1]).toBeCloseTo(0.95, 6);
  });

  it("reports no travel for a clip whose root does not drift vertically", () => {
    const clip = new AnimationClip("idle", 1, [
      new VectorKeyframeTrack("hips.position", [0, 1], [0, 1.0, 0, 0, 1.0, 0]),
    ]);
    expect(detrendClipRootY(clip).travel).toBe(0);
  });
});
