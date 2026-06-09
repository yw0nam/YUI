/**
 * project-anchor.test.ts — TDD red phase.
 *
 * Pins the contract for `projectFeetAnchor` — world feet point → screen px.
 * THREE camera/projection is pure math, so this runs in vitest node env
 * (same pattern as camera-fit.test.ts).
 *
 * The camera is positioned realistically via computeCameraFit (the renderer's
 * own framing math) so the projection mirrors the live fitCamera() path:
 * camera at center + (0,0,distance), looking at center.
 */

import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { computeCameraFit } from "./camera-fit";
import { projectFeetAnchor } from "./project-anchor";

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

/**
 * Build a camera framed on `box` exactly like renderer.fitCamera(), with the
 * fit distance scaled by `zoom` (>1 = closer = bigger character).
 */
function framedCamera(
  box: THREE.Box3,
  canvasW: number,
  canvasH: number,
  zoom = 1,
): THREE.PerspectiveCamera {
  const fov = 30;
  const aspect = canvasW / canvasH;
  const fit = computeCameraFit(box, { fov, aspect, margin: 0.1 })!;
  const d = fit.distance / zoom;
  const cam = new THREE.PerspectiveCamera(fov, aspect, 0.1, 20);
  cam.position.set(fit.target.x, fit.target.y, fit.target.z + d);
  cam.lookAt(fit.target);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  return cam;
}

// A typical full-body VRM box: ~1.7 tall, standing on the ground (minY = 0).
const VRM_BOX = boxOf([0, 0.85, 0], [0.5, 1.7, 0.3]);

describe("projectFeetAnchor — centering", () => {
  it("feet x is horizontally centered for a square canvas", () => {
    const w = 600;
    const h = 600;
    const cam = framedCamera(VRM_BOX, w, h);
    const a = projectFeetAnchor(VRM_BOX, cam, w, h)!;
    expect(a).not.toBeNull();
    expect(a.x).toBeCloseTo(w / 2, 3);
  });

  it("feet x is horizontally centered for a non-square (wide) canvas", () => {
    const w = 1280;
    const h = 720;
    const cam = framedCamera(VRM_BOX, w, h);
    const a = projectFeetAnchor(VRM_BOX, cam, w, h)!;
    expect(a).not.toBeNull();
    expect(a.x).toBeCloseTo(w / 2, 3);
  });
});

describe("projectFeetAnchor — vertical position", () => {
  it("feet land in the lower half of the canvas (y > canvasH/2)", () => {
    const w = 600;
    const h = 600;
    const cam = framedCamera(VRM_BOX, w, h);
    const a = projectFeetAnchor(VRM_BOX, cam, w, h)!;
    expect(a.y).toBeGreaterThan(h / 2);
  });

  it("feet y increases as the camera moves closer (bigger character)", () => {
    const w = 600;
    const h = 600;
    const far = projectFeetAnchor(VRM_BOX, framedCamera(VRM_BOX, w, h, 1), w, h)!;
    const near = projectFeetAnchor(VRM_BOX, framedCamera(VRM_BOX, w, h, 1.6), w, h)!;
    expect(near.y).toBeGreaterThan(far.y);
  });
});

describe("projectFeetAnchor — guards", () => {
  it("empty box ⇒ null", () => {
    const cam = framedCamera(VRM_BOX, 600, 600);
    expect(projectFeetAnchor(new THREE.Box3(), cam, 600, 600)).toBeNull();
  });
});
