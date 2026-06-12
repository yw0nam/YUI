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

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { computeCameraFit, nextZoom } from "./camera-fit";

/** Box spanning [cx±sx/2, cy±sy/2, cz±sz/2]. */
function boxOf(center: [number, number, number], size: [number, number, number]): THREE.Box3 {
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
    const infBox = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(Infinity, 1, 1));
    expect(computeCameraFit(infBox, { fov: 30, aspect: 1, margin: 0 })).toBeNull();

    const nanBox = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, Number.NaN, 1));
    expect(computeCameraFit(nanBox, { fov: 30, aspect: 1, margin: 0 })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// nextZoom — wheel-driven zoom factor stepping (applied on top of fit distance).
//
// next = current · exp(-deltaY · sensitivity), then clamp to [min, max].
// Wheel-up (deltaY < 0) INCREASES zoom (bigger character); wheel-down decreases.
// ─────────────────────────────────────────────────────────────────────────────

describe("nextZoom", () => {
  const opts = { min: 0.5, max: 3, sensitivity: 0.001 };

  it("deltaY < 0 (wheel up) increases zoom above current", () => {
    expect(nextZoom(1, -100, opts)).toBeGreaterThan(1);
  });

  it("deltaY > 0 (wheel down) decreases zoom below current", () => {
    expect(nextZoom(1, 100, opts)).toBeLessThan(1);
  });

  it("large negative deltaY saturates at max", () => {
    expect(nextZoom(1, -100000, opts)).toBe(3);
  });

  it("large positive deltaY saturates at min", () => {
    expect(nextZoom(1, 100000, opts)).toBe(0.5);
  });

  it("hand-computed: nextZoom(1, -100, sens 0.001) = exp(0.1)", () => {
    // next = 1 · exp(-(-100)·0.001) = exp(0.1) = 1.1051709180756477; within [0.5, 3].
    expect(nextZoom(1, -100, opts)).toBeCloseTo(1.1051709180756477, 12);
  });

  it("non-finite current ⇒ finite result within [min, max]", () => {
    const r = nextZoom(Number.NaN, -100, opts);
    expect(Number.isFinite(r)).toBe(true);
    expect(r).toBeGreaterThanOrEqual(0.5);
    expect(r).toBeLessThanOrEqual(3);
  });

  it("non-finite deltaY ⇒ finite result within [min, max]", () => {
    const r = nextZoom(1, Number.POSITIVE_INFINITY, opts);
    expect(Number.isFinite(r)).toBe(true);
    expect(r).toBeGreaterThanOrEqual(0.5);
    expect(r).toBeLessThanOrEqual(3);
  });
});
