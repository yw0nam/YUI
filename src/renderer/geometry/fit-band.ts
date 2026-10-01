/** Pure height-bound fit of a vertical band of the model box. */

import * as THREE from "three";
import type { FitBandConfig } from "../../config/load";

/** Frames the band of the box between from_frac and to_frac of its height, bound by height alone. */
export function computeBandFit(
  box: THREE.Box3,
  band: FitBandConfig,
  opts: { fov: number; margin: number },
): { target: THREE.Vector3; distance: number } | null {
  if (box.isEmpty()) return null;
  const center = box.getCenter(new THREE.Vector3());
  const h = box.max.y - box.min.y;
  const yFrom = box.min.y + h * band.from_frac;
  const yTo = box.min.y + h * band.to_frac;
  const tanV = Math.tan((opts.fov * Math.PI) / 180 / 2);
  const distance = ((yTo - yFrom) / 2 / tanV) * (1 + opts.margin);
  const target = new THREE.Vector3(center.x, (yFrom + yTo) / 2, center.z);
  if (
    !Number.isFinite(target.x) ||
    !Number.isFinite(target.y) ||
    !Number.isFinite(target.z) ||
    !Number.isFinite(distance) ||
    distance <= 0
  ) {
    return null;
  }
  return { target, distance };
}
