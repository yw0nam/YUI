/** The crop dialog's stage geometry: the photo's top-left in stage px under a fixed circular mask. */

import type { PhotoCrop, PhotoSize } from "../../../../settings/preset/photo-crop";

export const CIRCLE = 300;
export const MARGIN = 30;
export const STAGE = CIRCLE + 2 * MARGIN;
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 7;

/** `zoom` 1 fits the photo's short side to the circle; `left` and `top` place the photo in the stage. */
export interface Stage {
  zoom: number;
  left: number;
  top: number;
}

const scale = (st: Stage, p: PhotoSize): number => (st.zoom * CIRCLE) / Math.min(p.width, p.height);
const between = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Keeps the circle covered by the photo. */
export function clampStage(st: Stage, p: PhotoSize): Stage {
  const s = scale(st, p);
  return {
    zoom: st.zoom,
    left: between(st.left, MARGIN + CIRCLE - p.width * s, MARGIN),
    top: between(st.top, MARGIN + CIRCLE - p.height * s, MARGIN),
  };
}

export function stageOf(crop: PhotoCrop, p: PhotoSize): Stage {
  const zoom = between(Math.min(p.width, p.height) / (crop.size * p.width), MIN_ZOOM, MAX_ZOOM);
  const s = (zoom * CIRCLE) / Math.min(p.width, p.height);
  return clampStage(
    { zoom, left: MARGIN - crop.x * p.width * s, top: MARGIN - crop.y * p.height * s },
    p,
  );
}

export function cropOf(st: Stage, p: PhotoSize): PhotoCrop {
  const s = scale(st, p);
  return {
    x: (MARGIN - st.left) / s / p.width,
    y: (MARGIN - st.top) / s / p.height,
    size: CIRCLE / s / p.width,
  };
}

/** Zooms about the circle's centre. */
export function zoomAbout(st: Stage, zoom: number, p: PhotoSize): Stage {
  const centre = MARGIN + CIRCLE / 2;
  const from = scale(st, p);
  const to = scale({ ...st, zoom }, p);
  return clampStage(
    {
      zoom,
      left: centre - ((centre - st.left) / from) * to,
      top: centre - ((centre - st.top) / from) * to,
    },
    p,
  );
}
