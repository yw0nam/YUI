/**
 * hit-test — Phase-1 coarse hit predicate for per-region click-through.
 *
 * Projects a world Box3's 8 corners to canvas px (same NDC remap as
 * project-anchor.ts / perch-geometry.ts), takes the screen-space AABB, and
 * tests whether a CSS-px point falls inside it. Coarse bbox only — no GL
 * readback, no per-pixel alpha (a later phase). Pure THREE math (node-testable).
 */

import * as THREE from "three";

/** Reused scratch — corner projection may run on pointer events. */
const corner = new THREE.Vector3();

/**
 * True when (x, y) in canvas CSS px is inside the box's projected screen AABB.
 * Projects all 8 corners (a posed/rotated box's screen AABB needs every corner)
 * and bounds them. Empty box ⇒ false.
 */
export function pointInProjectedBox(
  box: THREE.Box3,
  camera: THREE.Camera,
  canvasW: number,
  canvasH: number,
  x: number,
  y: number,
): boolean {
  if (box.isEmpty()) return false;
  const { min, max } = box;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z).project(camera);
    const px = (corner.x * 0.5 + 0.5) * canvasW;
    const py = (1 - (corner.y * 0.5 + 0.5)) * canvasH;
    if (!Number.isFinite(px) || !Number.isFinite(py)) return false;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  return x >= minX && x <= maxX && y >= minY && y <= maxY;
}
