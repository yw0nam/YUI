/**
 * camera-fit — pure fit-to-bounds framing math.
 *
 * WebGL-free and deterministic so it runs in vitest node env. Given a VRM's
 * world bounding box, derives the camera distance/target/position that frames
 * the full body (head→feet) head-on. VRM faces +Z after VRMUtils.rotateVRM0,
 * so the camera sits in front at center + (0,0,distance).
 *
 * fov is vertical (degrees); aspect = width/height. Distance is the max of the
 * height-bound and width-bound fits (so arms aren't clipped on narrow windows),
 * scaled by (1 + margin).
 */

import * as THREE from "three";

export interface CameraFitOptions {
  /** Vertical field of view in degrees. */
  fov: number;
  /** Viewport aspect ratio (width / height). */
  aspect: number;
  /** Extra padding as a fraction of distance (e.g. 0.1 = 10%). */
  margin: number;
}

export interface CameraFit {
  position: THREE.Vector3;
  target: THREE.Vector3;
  distance: number;
}

/** Frames `box` head-on; returns null for empty or non-finite inputs. */
export function computeCameraFit(box: THREE.Box3, opts: CameraFitOptions): CameraFit | null {
  if (box.isEmpty()) return null;

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());

  const tanV = Math.tan((opts.fov * Math.PI) / 180 / 2);
  const distHeight = size.y / 2 / tanV;
  const distWidth = size.x / 2 / (opts.aspect * tanV);
  const distance = Math.max(distHeight, distWidth) * (1 + opts.margin);

  // Guards Infinity/NaN boxes and degenerate fov→0 / aspect→0 (distance non-finite).
  if (
    !Number.isFinite(center.x) ||
    !Number.isFinite(center.y) ||
    !Number.isFinite(center.z) ||
    !Number.isFinite(size.x) ||
    !Number.isFinite(size.y) ||
    !Number.isFinite(size.z) ||
    !Number.isFinite(distance)
  ) {
    return null;
  }

  const target = center.clone();
  const position = new THREE.Vector3(center.x, center.y, center.z + distance);
  return { position, target, distance };
}

/**
 * Wheel-driven zoom factor step (applied on top of the fit distance).
 *
 * next = current · exp(-deltaY · sensitivity), clamped to [min, max].
 * Wheel-up (deltaY < 0) increases zoom (bigger character); wheel-down decreases.
 * Non-finite current/deltaY/result fall back so the output stays within bounds.
 */
export function nextZoom(
  current: number,
  deltaY: number,
  opts: { min: number; max: number; sensitivity: number },
): number {
  const base = Number.isFinite(current) ? current : 1;
  const factor = Number.isFinite(deltaY) ? Math.exp(-deltaY * opts.sensitivity) : 1;
  const next = base * factor;
  return Math.min(opts.max, Math.max(opts.min, Number.isFinite(next) ? next : base));
}
