/**
 * project-anchor — world feet point → screen pixel projection.
 *
 * Projects the VRM bounding box's feet point (horizontal center, the bottom face's
 * lowest screen row) into canvas pixels so UI surfaces can anchor below the
 * character's feet as the camera reframes (resize / wheel-zoom / orbit). Pure THREE
 * math (node-testable).
 */

import * as THREE from "three";

export interface ScreenAnchor {
  /** Pixels from the left edge of the canvas. */
  x: number;
  /** Pixels from the top edge of the canvas. */
  y: number;
}

/** Reused scratch vectors — projection runs every frame. */
const feet = new THREE.Vector3();
const leftFoot = new THREE.Vector3();
const rightFoot = new THREE.Vector3();

/**
 * Project the box's feet to canvas pixels: x at the bottom face's center, y at its lowest
 * corner on screen. Returns null for an empty box or any non-finite projection.
 */
export function projectFeetAnchor(
  box: THREE.Box3,
  camera: THREE.Camera,
  canvasW: number,
  canvasH: number,
): ScreenAnchor | null {
  if (box.isEmpty()) return null;
  const { min, max } = box;
  feet.set((min.x + max.x) / 2, min.y, (min.z + max.z) / 2).project(camera);
  const x = (feet.x * 0.5 + 0.5) * canvasW;
  // The camera sits above the floor, so the bottom face's corner nearest it is its lowest row.
  let ndcY = Number.POSITIVE_INFINITY;
  for (const cx of [min.x, max.x]) {
    for (const cz of [min.z, max.z]) {
      ndcY = Math.min(ndcY, feet.set(cx, min.y, cz).project(camera).y);
    }
  }
  const y = (1 - (ndcY * 0.5 + 0.5)) * canvasH;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/**
 * Project the box's horizontal extremes at the feet point and return the canvas pixels
 * between them — how wide the character stands on screen. Returns null for an empty box
 * or any non-finite projection.
 */
export function projectBoxWidthPx(
  box: THREE.Box3,
  camera: THREE.Camera,
  canvasW: number,
): number | null {
  if (box.isEmpty()) return null;
  const { min, max } = box;
  const z = (min.z + max.z) / 2;
  leftFoot.set(min.x, min.y, z).project(camera);
  rightFoot.set(max.x, min.y, z).project(camera);
  const width = Math.abs(rightFoot.x - leftFoot.x) * 0.5 * canvasW;
  return Number.isFinite(width) ? width : null;
}
