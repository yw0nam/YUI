/**
 * perch-geometry — pure math for the "window-sit drop" perch.
 *
 * No three.js side effects, no DOM. Functions take THREE math objects
 * (Vector3, cameras) as inputs and return plain values / fresh vectors, so
 * they run in vitest node env (same pattern as project-anchor.ts).
 *
 * Coordinate spaces:
 *  - pet-window CSS px == logical px == "points" (origin top-left of canvas).
 *  - global screen target rects (kCGWindowBounds) are also in points, top-left.
 *  - pet window outerPosition() is PHYSICAL px → /scaleFactor to get points.
 *
 * Screen-Y is inverted (down = +y). Moving the character +worldY moves the
 * seat's screen-Y up (−screenY).
 */

import * as THREE from "three";
import type { ScreenRect } from "../contract";

/** Screen point in pet-window pixels (== logical px == points). */
export interface ScreenPoint {
  /** Pixels from the left edge of the canvas. */
  x: number;
  /** Pixels from the top edge of the canvas. */
  y: number;
}

/** Catch-zone band tuning. Vertical bands scale with the character's screen height. */
export interface CatchZoneOpts {
  /** Up band as a fraction of charH (default {@link CATCH_U}). */
  u?: number;
  /** Down band as a fraction of charH (default {@link CATCH_D}). */
  d?: number;
  /** Horizontal margin as a fraction of win.width on each side (default {@link CATCH_MX}). */
  mx?: number;
}

/** Side catch-zone band tuning, as fractions of the character's screen height. */
export interface SideCatchZoneOpts {
  /** Band extending away from the window (default {@link SIDE_OUT}). */
  out?: number;
  /** Band extending into the window (default {@link SIDE_IN}). */
  in?: number;
}

/** Catch-zone "up" band: fraction of char screen height above the window top. */
export const CATCH_U = 0.28;
/** Catch-zone "down" band: fraction of char screen height below the window top. */
export const CATCH_D = 0.23;
/** Catch-zone horizontal margin: fraction of window width on each side. */
export const CATCH_MX = 0.0;
/** Side catch-zone band extending away from the window edge. */
export const SIDE_OUT = 0.28;
/** Side catch-zone band extending into the window interior. */
export const SIDE_IN = 0.23;
/** Default seat drop below the hip bone (world units). Tuned visually later. */
export const SEAT_DROP_DEFAULT = 0.0;

/** Reused scratch vector — projection may run every frame. */
const scratch = new THREE.Vector3();

/**
 * Project a world point to canvas pixels via the NDC remap.
 * Mirrors project-anchor.ts: x=(v.x*0.5+0.5)*W, y=(1-(v.y*0.5+0.5))*H.
 * Returns null for any non-finite projection (e.g. point at the camera eye).
 */
export function projectToScreen(
  world: THREE.Vector3,
  camera: THREE.Camera,
  canvasW: number,
  canvasH: number,
): ScreenPoint | null {
  scratch.copy(world).project(camera);
  const x = (scratch.x * 0.5 + 0.5) * canvasW;
  const y = (1 - (scratch.y * 0.5 + 0.5)) * canvasH;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/**
 * In-place buttock-contact world point: writes the hip world position dropped
 * by `seatDrop` on Y only into `out`. Allocates nothing — for the per-frame pin.
 */
export function seatAnchorWorldInto(
  out: THREE.Vector3,
  hipsWorld: THREE.Vector3,
  seatDrop: number,
): THREE.Vector3 {
  out.copy(hipsWorld);
  out.y -= seatDrop;
  return out;
}

/**
 * Buttock-contact world point: the hip bone world position dropped by
 * `seatDrop` on Y only (the seat sits below the hip joint). Returns a fresh
 * vector — for non-hot callers; the pin path uses {@link seatAnchorWorldInto}.
 */
export function seatAnchorWorld(hipsWorld: THREE.Vector3, seatDrop: number): THREE.Vector3 {
  return seatAnchorWorldInto(new THREE.Vector3(), hipsWorld, seatDrop);
}

/**
 * Character's on-screen height in pixels: |head.screenY − feet.screenY|.
 * Null if either world point fails to project.
 */
export function characterScreenHeight(
  headWorld: THREE.Vector3,
  feetWorld: THREE.Vector3,
  camera: THREE.Camera,
  canvasW: number,
  canvasH: number,
): number | null {
  const head = projectToScreen(headWorld, camera, canvasW, canvasH);
  const feet = projectToScreen(feetWorld, camera, canvasW, canvasH);
  if (head === null || feet === null) return null;
  return Math.abs(head.y - feet.y);
}

/**
 * Convert a pet-window pixel to a global screen point.
 * outerPos is PHYSICAL px → /scaleFactor yields points, then add the pet px.
 * scaleFactor <= 0 is treated as 1 (guards divide-by-zero / sign flip).
 */
export function petPxToGlobalPoints(
  px: ScreenPoint,
  winOuterPosPhysical: ScreenPoint,
  scaleFactor: number,
): ScreenPoint {
  const sf = scaleFactor > 0 ? scaleFactor : 1;
  return {
    x: winOuterPosPhysical.x / sf + px.x,
    y: winOuterPosPhysical.y / sf + px.y,
  };
}

/**
 * Whether a seat point (global points) is inside the window's catch zone.
 * Vertical band scales with the character's screen height; horizontal band
 * widens by mx*win.width on each side. All inputs in points.
 *
 *  horizontal: win.x - mx*W ≤ seat.x ≤ win.x + W + mx*W
 *  vertical:   win.y - u*charH ≤ seat.y ≤ win.y + d*charH
 */
export function inCatchZone(
  seatGlobalPts: ScreenPoint,
  win: ScreenRect,
  charHpx: number,
  opts?: CatchZoneOpts,
): boolean {
  const u = opts?.u ?? CATCH_U;
  const d = opts?.d ?? CATCH_D;
  const mx = opts?.mx ?? CATCH_MX;

  const marginX = mx * win.width;
  const left = win.x - marginX;
  const right = win.x + win.width + marginX;
  const top = win.y - u * charHpx;
  const bottom = win.y + d * charHpx;

  return (
    seatGlobalPts.x >= left &&
    seatGlobalPts.x <= right &&
    seatGlobalPts.y >= top &&
    seatGlobalPts.y <= bottom
  );
}

/** Return the side edge whose horizontal catch band contains the seat point. */
export function inSideCatchZone(
  seatGlobalPts: ScreenPoint,
  win: ScreenRect,
  charHpx: number,
  opts?: SideCatchZoneOpts,
): "left" | "right" | null {
  if (seatGlobalPts.y < win.y || seatGlobalPts.y > win.y + win.height) return null;

  const out = (opts?.out ?? SIDE_OUT) * charHpx;
  const inside = (opts?.in ?? SIDE_IN) * charHpx;
  const leftEdge = win.x;
  if (seatGlobalPts.x >= leftEdge - out && seatGlobalPts.x <= leftEdge + inside) {
    return "left";
  }

  const rightEdge = win.x + win.width;
  if (seatGlobalPts.x >= rightEdge - inside && seatGlobalPts.x <= rightEdge + out) {
    return "right";
  }
  return null;
}

/**
 * Perspective vertical world-units spanned by one screen pixel at a given
 * depth from the camera. `seatDepthFromCamera` is the depth measured ALONG the
 * camera's view axis (forward-projected), not the Euclidean distance — the
 * formula assumes the on-axis depth of the perspective frustum.
 *   (2 * depth * tan(fovY/2)) / canvasH
 */
export function worldYPerPixel(
  camera: THREE.PerspectiveCamera,
  seatDepthFromCamera: number,
  canvasH: number,
): number {
  const halfFovRad = (camera.fov * Math.PI) / 180 / 2;
  return (2 * seatDepthFromCamera * Math.tan(halfFovRad)) / canvasH;
}

/**
 * World-Y delta to apply to the character so the seat's screen-Y moves from
 * `seatScreenYpx` to `targetTopScreenYpx`. Screen-Y is inverted (down = +);
 * moving the character +worldY moves the seat −screenY, so:
 *   Δworld = -(targetTopScreenYpx − seatScreenYpx) * worldYPerPixel
 * Moving the seat UP on screen (smaller target screen-Y) ⇒ positive Δworld.
 */
export function seatOffsetWorldY(
  seatScreenYpx: number,
  targetTopScreenYpx: number,
  worldYPerPixel: number,
): number {
  return -(targetTopScreenYpx - seatScreenYpx) * worldYPerPixel;
}
