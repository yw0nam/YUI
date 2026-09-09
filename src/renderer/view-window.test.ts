/**
 * view-window.test.ts
 *
 * Pins the contract for `applyViewWindow`: the reference-size framing renders at its
 * offset inside a larger canvas exactly as it would on its own reference-size canvas.
 * THREE camera/projection is pure math, so this runs in vitest node env (same pattern
 * as project-anchor.test.ts).
 */

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { computeCameraFit } from "./camera-fit";
import { projectBoxWidthPx, projectFeetAnchor } from "./project-anchor";
import { applyViewWindow, type ViewWindow } from "./view-window";

/** Box spanning [cx±sx/2, cy±sy/2, cz±sz/2]. */
function boxOf(center: [number, number, number], size: [number, number, number]): THREE.Box3 {
  const [cx, cy, cz] = center;
  const [sx, sy, sz] = size;
  return new THREE.Box3(
    new THREE.Vector3(cx - sx / 2, cy - sy / 2, cz - sz / 2),
    new THREE.Vector3(cx + sx / 2, cy + sy / 2, cz + sz / 2),
  );
}

/** A camera framed on `box` at `aspect`, matching renderer.fitCamera()'s own math. */
function framedCameraAt(box: THREE.Box3, aspect: number): THREE.PerspectiveCamera {
  const fov = 30;
  const fit = computeCameraFit(box, { fov, aspect, margin: 0.1 })!;
  const cam = new THREE.PerspectiveCamera(fov, aspect, 0.1, 20);
  cam.position.set(fit.target.x, fit.target.y, fit.target.z + fit.distance);
  cam.lookAt(fit.target);
  cam.updateProjectionMatrix();
  return cam;
}

// A typical full-body VRM box: ~1.7 tall, standing on the ground (minY = 0).
const VRM_BOX = boxOf([0, 0.85, 0], [0.5, 1.7, 0.3]);

describe("applyViewWindow", () => {
  it("draws the reference framing at its offset, matching the un-offset render", () => {
    const referenceAspect = 400 / 600;

    const baseline = framedCameraAt(VRM_BOX, referenceAspect);
    baseline.updateMatrixWorld();
    const baseAnchor = projectFeetAnchor(VRM_BOX, baseline, 400, 600)!;
    const baseWidth = projectBoxWidthPx(VRM_BOX, baseline, 400)!;

    const travel = framedCameraAt(VRM_BOX, referenceAspect);
    const view: ViewWindow = { x: 0, y: 1100, width: 400, height: 600 };
    applyViewWindow(travel, view, 400, 1700);
    travel.updateMatrixWorld();
    const travelAnchor = projectFeetAnchor(VRM_BOX, travel, 400, 1700)!;
    const travelWidth = projectBoxWidthPx(VRM_BOX, travel, 400)!;

    expect(Math.abs(travelAnchor.x - baseAnchor.x)).toBeLessThan(1);
    expect(Math.abs(travelAnchor.y - (baseAnchor.y + 1100))).toBeLessThan(1);
    expect(Math.abs(travelWidth - baseWidth)).toBeLessThan(1);
  });

  it("clears the offset back to filling the whole canvas", () => {
    const cam = framedCameraAt(VRM_BOX, 400 / 600);
    applyViewWindow(cam, { x: 0, y: 1100, width: 400, height: 600 }, 400, 1700);

    applyViewWindow(cam, null, 400, 1700);

    expect(cam.view?.enabled).toBe(false);
  });
});
