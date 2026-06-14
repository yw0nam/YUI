/**
 * hit-test.test.ts — TDD red phase.
 *
 * Pins the contract for `pointInProjectedBox` — the pure Phase-1 hit predicate:
 * project a world Box3's 8 corners to screen px, take the screen-space AABB,
 * and test whether a CSS-px point falls inside it. THREE projection is pure
 * math, so this runs in vitest node env (same pattern as project-anchor.test.ts).
 */

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { computeCameraFit } from "./camera-fit";
import { pointInProjectedBox } from "./hit-test";

/** Box spanning [cx±sx/2, cy±sy/2, cz±sz/2]. */
function boxOf(center: [number, number, number], size: [number, number, number]): THREE.Box3 {
  const [cx, cy, cz] = center;
  const [sx, sy, sz] = size;
  return new THREE.Box3(
    new THREE.Vector3(cx - sx / 2, cy - sy / 2, cz - sz / 2),
    new THREE.Vector3(cx + sx / 2, cy + sy / 2, cz + sz / 2),
  );
}

/** Camera framed on `box` exactly like renderer.fitCamera() (mirrors project-anchor.test.ts). */
function framedCamera(box: THREE.Box3, canvasW: number, canvasH: number): THREE.PerspectiveCamera {
  const fov = 30;
  const aspect = canvasW / canvasH;
  const fit = computeCameraFit(box, { fov, aspect, margin: 0.1 })!;
  const cam = new THREE.PerspectiveCamera(fov, aspect, 0.1, 20);
  cam.position.set(fit.target.x, fit.target.y, fit.target.z + fit.distance);
  cam.lookAt(fit.target);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  return cam;
}

const VRM_BOX = boxOf([0, 0.85, 0], [0.5, 1.7, 0.3]);

describe("pointInProjectedBox — inside / outside", () => {
  const w = 600;
  const h = 600;
  const cam = framedCamera(VRM_BOX, w, h);

  it("canvas center is inside the projected box", () => {
    expect(pointInProjectedBox(VRM_BOX, cam, w, h, w / 2, h / 2)).toBe(true);
  });

  it("a corner of the canvas is outside the projected box", () => {
    expect(pointInProjectedBox(VRM_BOX, cam, w, h, 2, 2)).toBe(false);
  });

  it("far below the canvas is outside", () => {
    expect(pointInProjectedBox(VRM_BOX, cam, w, h, w / 2, h * 10)).toBe(false);
  });
});

describe("pointInProjectedBox — 8-corner AABB", () => {
  it("a box rotated about its center keeps an interior point inside the screen AABB", () => {
    const w = 600;
    const h = 600;
    const cam = framedCamera(VRM_BOX, w, h);
    // The character's screen AABB always contains the projected center, even when
    // the source box is non-axis-aligned to the camera; all 8 corners bound it.
    const center = new THREE.Vector3();
    VRM_BOX.getCenter(center).project(cam);
    const cx = (center.x * 0.5 + 0.5) * w;
    const cy = (1 - (center.y * 0.5 + 0.5)) * h;
    expect(pointInProjectedBox(VRM_BOX, cam, w, h, cx, cy)).toBe(true);
  });

  it("the screen AABB spans all corners — a point just inside the widest x extent is inside", () => {
    const w = 600;
    const h = 600;
    const cam = framedCamera(VRM_BOX, w, h);
    // Widest projected corner is the near-bottom edge; a point at canvas center y
    // and 1px inside the left extent must register as inside.
    const corners: THREE.Vector3[] = [];
    const { min, max } = VRM_BOX;
    for (const x of [min.x, max.x])
      for (const y of [min.y, max.y])
        for (const z of [min.z, max.z]) corners.push(new THREE.Vector3(x, y, z).project(cam));
    const xs = corners.map((c) => (c.x * 0.5 + 0.5) * w);
    const minX = Math.min(...xs);
    expect(pointInProjectedBox(VRM_BOX, cam, w, h, minX + 1, h / 2)).toBe(true);
    expect(pointInProjectedBox(VRM_BOX, cam, w, h, minX - 5, h / 2)).toBe(false);
  });
});

describe("pointInProjectedBox — guards", () => {
  it("empty box ⇒ false", () => {
    const cam = framedCamera(VRM_BOX, 600, 600);
    expect(pointInProjectedBox(new THREE.Box3(), cam, 600, 600, 300, 300)).toBe(false);
  });
});
