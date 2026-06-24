/**
 * camera-fit.test.ts
 *
 * Pins the contract for the pure `computeCameraFit` helper —
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
import {
  CAMERA_AZIMUTH_DEFAULT,
  CAMERA_POLAR_DEFAULT,
  CAMERA_POLAR_FREE_MAX,
  CAMERA_POLAR_FREE_MIN,
  CAMERA_POLAR_PERCHED_MAX,
  CAMERA_POLAR_PERCHED_MIN,
  clampPolar,
  computeCameraFit,
  nextZoom,
  orbitPosition,
} from "./camera-fit";

const DEG = Math.PI / 180;

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

// ─────────────────────────────────────────────────────────────────────────────
// orbitPosition — camera position on the orbit sphere (radius, polar, azimuth).
//
// Orbit model: THREE.Spherical(radius, polar φ from +Y, azimuth θ). Cartesian:
//   x = radius·sin(φ)·sin(θ), y = radius·cos(φ), z = radius·sin(φ)·cos(θ)
// Default (azimuth 0, polar 90°) reproduces the head-on position target+(0,0,radius).
// ─────────────────────────────────────────────────────────────────────────────

describe("orbit angle constants", () => {
  it("default azimuth is 0", () => {
    expect(CAMERA_AZIMUTH_DEFAULT).toBe(0);
  });

  it("default polar is 90° (π/2) — straight-on", () => {
    expect(CAMERA_POLAR_DEFAULT).toBeCloseTo(Math.PI / 2, 12);
  });

  it("free polar range is near-full [2°, 178°]", () => {
    expect(CAMERA_POLAR_FREE_MIN).toBeCloseTo(2 * DEG, 12);
    expect(CAMERA_POLAR_FREE_MAX).toBeCloseTo(178 * DEG, 12);
  });

  it("perched polar range is [60°, 120°]", () => {
    expect(CAMERA_POLAR_PERCHED_MIN).toBeCloseTo(60 * DEG, 12);
    expect(CAMERA_POLAR_PERCHED_MAX).toBeCloseTo(120 * DEG, 12);
  });
});

describe("orbitPosition — default angles reproduce head-on", () => {
  it("(azimuth 0, polar 90°) ⇒ target + (0, 0, radius)", () => {
    const target = new THREE.Vector3(0.2, 1.1, -0.3);
    const pos = orbitPosition(target, 3, {
      azimuth: CAMERA_AZIMUTH_DEFAULT,
      polar: CAMERA_POLAR_DEFAULT,
    });
    expect(pos.x).toBeCloseTo(0.2, 6);
    expect(pos.y).toBeCloseTo(1.1, 6);
    expect(pos.z).toBeCloseTo(-0.3 + 3, 6);
  });

  it("matches computeCameraFit's head-on position at default angles", () => {
    const fit = computeCameraFit(
      new THREE.Box3(new THREE.Vector3(-0.3, 0.1, -0.5), new THREE.Vector3(0.3, 1.9, 0.5)),
      { fov: 30, aspect: 1, margin: 0 },
    )!;
    const pos = orbitPosition(fit.target, fit.distance, {
      azimuth: CAMERA_AZIMUTH_DEFAULT,
      polar: CAMERA_POLAR_DEFAULT,
    });
    expect(pos.x).toBeCloseTo(fit.position.x, 6);
    expect(pos.y).toBeCloseTo(fit.position.y, 6);
    expect(pos.z).toBeCloseTo(fit.position.z, 6);
  });

  it("preserves the orbit radius (distance from target is `radius` at any angle)", () => {
    const target = new THREE.Vector3(0, 1, 0);
    for (const az of [0, 0.7, Math.PI]) {
      for (const pol of [30 * DEG, 90 * DEG, 150 * DEG]) {
        const pos = orbitPosition(target, 2.5, { azimuth: az, polar: pol });
        expect(pos.distanceTo(target)).toBeCloseTo(2.5, 6);
      }
    }
  });
});

describe("orbitPosition — azimuth rotates in the horizontal (xz) plane", () => {
  it("azimuth 90° moves the camera onto the +X side, z→target.z", () => {
    const target = new THREE.Vector3(0, 1, 0);
    const pos = orbitPosition(target, 3, { azimuth: 90 * DEG, polar: 90 * DEG });
    expect(pos.x).toBeCloseTo(3, 6);
    expect(pos.y).toBeCloseTo(1, 6);
    expect(pos.z).toBeCloseTo(0, 6);
  });

  it("azimuth leaves the camera height (y) unchanged at polar 90°", () => {
    const target = new THREE.Vector3(0, 1, 0);
    const a = orbitPosition(target, 3, { azimuth: 0, polar: 90 * DEG });
    const b = orbitPosition(target, 3, { azimuth: 0.9, polar: 90 * DEG });
    expect(b.y).toBeCloseTo(a.y, 6);
  });
});

describe("orbitPosition — polar tilts vertically (look from above/below)", () => {
  it("polar < 90° raises the camera above the target (look-from-above)", () => {
    const target = new THREE.Vector3(0, 1, 0);
    const pos = orbitPosition(target, 3, { azimuth: 0, polar: 60 * DEG });
    // y = target.y + radius·cos(60°) = 1 + 3·0.5 = 2.5
    expect(pos.y).toBeCloseTo(2.5, 6);
    expect(pos.y).toBeGreaterThan(1);
  });

  it("polar > 90° drops the camera below the target (look-from-below)", () => {
    const target = new THREE.Vector3(0, 1, 0);
    const pos = orbitPosition(target, 3, { azimuth: 0, polar: 120 * DEG });
    // y = 1 + 3·cos(120°) = 1 - 1.5 = -0.5
    expect(pos.y).toBeCloseTo(-0.5, 6);
    expect(pos.y).toBeLessThan(1);
  });
});

describe("orbitPosition — guards", () => {
  it("non-finite radius falls back to a finite position", () => {
    const target = new THREE.Vector3(0, 1, 0);
    const pos = orbitPosition(target, Number.NaN, { azimuth: 0, polar: 90 * DEG });
    expect(Number.isFinite(pos.x)).toBe(true);
    expect(Number.isFinite(pos.y)).toBe(true);
    expect(Number.isFinite(pos.z)).toBe(true);
  });

  it("non-finite angles fall back to a finite position", () => {
    const target = new THREE.Vector3(0, 1, 0);
    const pos = orbitPosition(target, 3, { azimuth: Number.NaN, polar: Number.POSITIVE_INFINITY });
    expect(Number.isFinite(pos.x)).toBe(true);
    expect(Number.isFinite(pos.y)).toBe(true);
    expect(Number.isFinite(pos.z)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// clampPolar — state-dependent polar clamp. azimuth is never clamped here.
//   not perched: [2°, 178°]   perched: [60°, 120°]
// ─────────────────────────────────────────────────────────────────────────────

describe("clampPolar — not perched (near-full free viewing [2°, 178°])", () => {
  it("passes a polar already inside the free range", () => {
    expect(clampPolar(90 * DEG, false)).toBeCloseTo(90 * DEG, 12);
    expect(clampPolar(45 * DEG, false)).toBeCloseTo(45 * DEG, 12);
  });

  it("near-overhead (5°) and near-underneath (175°) pass — almost the full sphere", () => {
    expect(clampPolar(5 * DEG, false)).toBeCloseTo(5 * DEG, 12);
    expect(clampPolar(175 * DEG, false)).toBeCloseTo(175 * DEG, 12);
  });

  it("clamps below 2° up to the 2° pole-epsilon floor", () => {
    expect(clampPolar(0.5 * DEG, false)).toBeCloseTo(2 * DEG, 12);
  });

  it("clamps above 178° down to the 178° pole-epsilon ceiling", () => {
    expect(clampPolar(179.5 * DEG, false)).toBeCloseTo(178 * DEG, 12);
  });
});

describe("clampPolar — perched (tightened to [60°, 120°])", () => {
  it("passes a polar already inside the perched range", () => {
    expect(clampPolar(90 * DEG, true)).toBeCloseTo(90 * DEG, 12);
    expect(clampPolar(75 * DEG, true)).toBeCloseTo(75 * DEG, 12);
  });

  it("a free-but-out-of-perched angle is pulled into range on perch", () => {
    // 20° is valid free, but perch tightens it to the 60° floor.
    expect(clampPolar(20 * DEG, true)).toBeCloseTo(60 * DEG, 12);
    // 150° free → 120° perched ceiling.
    expect(clampPolar(150 * DEG, true)).toBeCloseTo(120 * DEG, 12);
  });

  it("non-finite polar falls back to the default (90°)", () => {
    expect(clampPolar(Number.NaN, true)).toBeCloseTo(CAMERA_POLAR_DEFAULT, 12);
    expect(clampPolar(Number.POSITIVE_INFINITY, false)).toBeCloseTo(CAMERA_POLAR_DEFAULT, 12);
  });
});
