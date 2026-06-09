/**
 * project-anchor — world feet point → screen pixel projection.
 *
 * Projects the VRM bounding box's ground-center (horizontal center, lowest y)
 * into canvas pixels so UI surfaces can anchor below the character's feet as
 * the camera reframes (resize / wheel-zoom). Pure THREE math (node-testable).
 */

import * as THREE from "three";

export interface ScreenAnchor {
  /** Pixels from the left edge of the canvas. */
  x: number;
  /** Pixels from the top edge of the canvas. */
  y: number;
}

/** Reused scratch vector — projection runs every frame. */
const feet = new THREE.Vector3();

/**
 * Project the box's feet point (center x/z, min y) to canvas pixels.
 * Returns null for an empty box or any non-finite projection.
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
  const y = (1 - (feet.y * 0.5 + 0.5)) * canvasH;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}
