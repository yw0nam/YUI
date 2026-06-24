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

/** Orbit angles on the view sphere (radians). azimuth θ around +Y, polar φ from +Y. */
export interface OrbitAngles {
  /** Azimuth around +Y (radians). 0 = head-on; free (unclamped). */
  azimuth: number;
  /** Polar from +Y (radians). π/2 = level/head-on. */
  polar: number;
}

const DEG = Math.PI / 180;

/** Head-on default azimuth (radians). */
export const CAMERA_AZIMUTH_DEFAULT = 0;
/** Head-on default polar (radians) — π/2 = level, straight-on. */
export const CAMERA_POLAR_DEFAULT = Math.PI / 2;
/**
 * Free-viewing polar floor (radians). Near-overhead — a 2° epsilon off the +Y pole
 * keeps `lookAt` with up=(0,1,0) out of the gimbal singularity (no pole crossing).
 */
export const CAMERA_POLAR_FREE_MIN = 2 * DEG;
/** Free-viewing polar ceiling (radians). Near-underneath — 2° epsilon off the -Y pole. */
export const CAMERA_POLAR_FREE_MAX = 178 * DEG;
/** Perched polar floor (radians) — tightened so the seat-pin gain error stays small. */
export const CAMERA_POLAR_PERCHED_MIN = 60 * DEG;
/** Perched polar ceiling (radians). */
export const CAMERA_POLAR_PERCHED_MAX = 120 * DEG;

/**
 * Clamp a polar angle to the active range. azimuth is never clamped.
 *   not perched: [2°, 178°] (free viewing)
 *   perched:     [60°, 120°] (keeps the perch seat-pin gain error small)
 * Non-finite input falls back to the head-on default (π/2).
 */
export function clampPolar(polar: number, perched: boolean): number {
  if (!Number.isFinite(polar)) return CAMERA_POLAR_DEFAULT;
  const min = perched ? CAMERA_POLAR_PERCHED_MIN : CAMERA_POLAR_FREE_MIN;
  const max = perched ? CAMERA_POLAR_PERCHED_MAX : CAMERA_POLAR_FREE_MAX;
  return Math.min(max, Math.max(min, polar));
}

/**
 * Camera position on the orbit sphere of the given `radius` around `target`.
 * Uses THREE.Spherical(radius, polar, azimuth); default angles (0, π/2) reproduce
 * the head-on position `target + (0, 0, radius)`. Non-finite radius/angles fall back
 * to head-on so the camera never lands on a NaN position. Returns a fresh vector.
 */
export function orbitPosition(
  target: THREE.Vector3,
  radius: number,
  angles: OrbitAngles,
): THREE.Vector3 {
  const r = Number.isFinite(radius) ? radius : 0;
  const azimuth = Number.isFinite(angles.azimuth) ? angles.azimuth : CAMERA_AZIMUTH_DEFAULT;
  const polar = Number.isFinite(angles.polar) ? angles.polar : CAMERA_POLAR_DEFAULT;
  const offset = new THREE.Vector3().setFromSpherical(new THREE.Spherical(r, polar, azimuth));
  return target.clone().add(offset);
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
