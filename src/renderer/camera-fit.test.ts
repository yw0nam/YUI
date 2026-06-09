/**
 * camera-fit.test.ts — TDD red phase (#106).
 *
 * Pins the contract for the pure `computeCameraFit` helper (not yet written) —
 * full-body fit-to-bounds framing. THREE.Box3/Vector3 are pure math, so this
 * runs in vitest node env (same pattern as emotion-resolver.test.ts).
 *
 * Expected distances are hand-computed and pinned as literals (toBeCloseTo),
 * NOT recomputed via the helper's formula, so the test independently fixes
 * the contract. Reference (fov vertical, degrees; aspect = w/h):
 *   tanV = tan(fov·π/180 / 2)
 *   distHeight = (sizeY/2) / tanV
 *   distWidth  = (sizeX/2) / (aspect · tanV)
 *   distance   = max(distHeight, distWidth) · (1 + margin)
 *   tan(15°) = 0.2679491924311227, tan(30°) = 0.5773502691896257
 */

import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { computeCameraFit } from "./camera-fit";

/** Box spanning [cx±sx/2, cy±sy/2, cz±sz/2]. */
function boxOf(
  center: [number, number, number],
  size: [number, number, number],
): THREE.Box3 {
  const [cx, cy, cz] = center;
  const [sx, sy, sz] = size;
  return new THREE.Box3(
    new THREE.Vector3(cx - sx / 2, cy - sy / 2, cz - sz / 2),
    new THREE.Vector3(cx + sx / 2, cy + sy / 2, cz + sz / 2),
  );
}

describe("computeCameraFit — distance scaling", () => {
  it("taller box yields a larger distance than a shorter box (same fov/aspect/margin)", () => {
    const opts = { fov: 30, aspect: 1, margin: 0 };
    const tall = computeCameraFit(boxOf([0, 1, 0], [0.6, 1.8, 0.4]), opts)!;
    const short = computeCameraFit(boxOf([0, 1, 0], [0.6, 0.5, 0.4]), opts)!;
    expect(tall).not.toBeNull();
    expect(short).not.toBeNull();
    expect(tall.distance).toBeGreaterThan(short.distance);
  });

  it("height binds for a tall-narrow box: distance = (sizeY/2)/tanV (aspect=1, margin=0)", () => {
    // sizeY=1.8, tanV(15°)=0.2679491924 → distHeight=3.35884572681199;
    // distWidth (sizeX=0.6, aspect=1) = 1.1196152422706631 → height wins.
    const fit = computeCameraFit(boxOf([0, 1, 0], [0.6, 1.8, 0.4]), {
      fov: 30,
      aspect: 1,
      margin: 0,
    })!;
    expect(fit.distance).toBeCloseTo(3.35884572681199, 6);
  });

  it("width binds for a wide-short box at a narrow aspect: distance = (sizeX/2)/(aspect·tanV)", () => {
    // sizeX=4, aspect=0.5, tanV(15°)=0.2679491924 → distWidth=14.92820323027551;
    // distHeight (sizeY=1) = 1.8660254037844388 → width wins.
    const fit = computeCameraFit(boxOf([0, 0.5, 0], [4, 1, 0.4]), {
      fov: 30,
      aspect: 0.5,
      margin: 0,
    })!;
    expect(fit.distance).toBeCloseTo(14.92820323027551, 6);
  });

  it("larger margin strictly increases distance proportional to (1 + margin)", () => {
    const box = boxOf([0, 1, 0], [0.6, 1.8, 0.4]);
    const base = computeCameraFit(box, { fov: 30, aspect: 1, margin: 0 })!;
    const padded = computeCameraFit(box, { fov: 30, aspect: 1, margin: 0.1 })!;
    expect(padded.distance).toBeGreaterThan(base.distance);
    // 3.35884572681199 · 1.1 = 3.694730299493189
    expect(padded.distance).toBeCloseTo(3.694730299493189, 6);
    expect(padded.distance).toBeCloseTo(base.distance * 1.1, 6);
  });

  it("fov widening shrinks distance (fov=60, height-bound)", () => {
    // sizeY=1.8, tanV(30°)=0.5773502691896257 → distHeight=1.5588457268119897.
    const fit = computeCameraFit(boxOf([0, 1, 0], [0.6, 1.8, 0.4]), {
      fov: 60,
      aspect: 1,
      margin: 0,
    })!;
    expect(fit.distance).toBeCloseTo(1.5588457268119897, 6);
  });
});

describe("computeCameraFit — target and position", () => {
  it("target equals the box center", () => {
    const fit = computeCameraFit(boxOf([0.2, 1.1, -0.3], [0.6, 1.8, 0.4]), {
      fov: 30,
      aspect: 1,
      margin: 0,
    })!;
    expect(fit.target.x).toBeCloseTo(0.2, 6);
    expect(fit.target.y).toBeCloseTo(1.1, 6);
    expect(fit.target.z).toBeCloseTo(-0.3, 6);
  });

  it("position sits in front along +Z at center + (0,0,distance)", () => {
    // height-bound: distance = 3.35884572681199; center z = -0.3.
    const fit = computeCameraFit(boxOf([0.2, 1.1, -0.3], [0.6, 1.8, 0.4]), {
      fov: 30,
      aspect: 1,
      margin: 0,
    })!;
    expect(fit.position.x).toBeCloseTo(0.2, 6);
    expect(fit.position.y).toBeCloseTo(1.1, 6);
    expect(fit.position.z).toBeCloseTo(-0.3 + 3.35884572681199, 6);
  });
});

describe("computeCameraFit — guards", () => {
  it("empty box ⇒ null", () => {
    expect(computeCameraFit(new THREE.Box3(), { fov: 30, aspect: 1, margin: 0 })).toBeNull();
  });

  it("box with a non-finite component ⇒ null", () => {
    const infBox = new THREE.Box3(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(Infinity, 1, 1),
    );
    expect(computeCameraFit(infBox, { fov: 30, aspect: 1, margin: 0 })).toBeNull();

    const nanBox = new THREE.Box3(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, Number.NaN, 1),
    );
    expect(computeCameraFit(nanBox, { fov: 30, aspect: 1, margin: 0 })).toBeNull();
  });
});
