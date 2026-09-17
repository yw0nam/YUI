/**
 * view-window — draws the reference-size framing at an offset inside a larger canvas.
 *
 * A travel parks the OS window over its whole path and hands the movers a virtual window
 * inside it; the camera keeps framing the window's size at travel start (the reference
 * size) but draws it at the virtual window's offset within the parked canvas, via
 * three.js's multi-view `camera.setViewOffset`.
 */

import type * as THREE from "three";

export interface ViewWindow {
  /** Canvas offset (px) where the reference framing is drawn. */
  x: number;
  y: number;
  /** The reference framing's own size (px) — the window size at travel start. */
  width: number;
  height: number;
}

/**
 * Offsets `camera`'s projection so the `view.width`×`view.height` reference framing
 * renders at `(view.x, view.y)` inside the `canvasW`×`canvasH` canvas. `view` null clears
 * the offset back to filling the whole canvas. `camera.aspect` must already be
 * `view.width / view.height` (or `canvasW / canvasH` when `view` is null) — this only
 * applies the offset, it does not touch aspect or re-fit.
 */
export function applyViewWindow(
  camera: THREE.PerspectiveCamera,
  view: ViewWindow | null,
  canvasW: number,
  canvasH: number,
): void {
  if (view) {
    camera.setViewOffset(view.width, view.height, -view.x, -view.y, canvasW, canvasH);
  } else {
    camera.clearViewOffset();
  }
}
