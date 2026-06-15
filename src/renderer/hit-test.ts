/**
 * hit-test — pure helpers for the per-pixel alpha silhouette predicate.
 *
 * The renderer keeps a CPU-side low-res RGBA grab of the visible drawing buffer
 * (refreshed inside the rAF loop right after render). These pure functions decide
 * a hit against that grab: map a CSS-px point to a grab cell (with the Y-flip
 * readPixels needs), then threshold the alpha with a small 3×3 dilation so thin
 * features (fingers, hair) and the low-res grid stay forgiving. No GL here —
 * node-testable.
 */

/** A cell coordinate in the low-res grab (col left→right, row bottom→top). */
export interface GrabCell {
  col: number;
  row: number;
}

/** Pixel size of the offscreen alpha grab (gw×gh). */
export interface GrabSize {
  gw: number;
  gh: number;
}

/**
 * Size the offscreen alpha grab from the device buffer: scale the width by `scale`
 * (linear), cap it at `maxW`, and derive the height from the device aspect. Both
 * dims floor to >=1. Returns null for a non-positive buffer (nothing to grab).
 */
export function grabDimensions(
  bw: number,
  bh: number,
  scale: number,
  maxW: number,
): GrabSize | null {
  if (bw <= 0 || bh <= 0) return null;
  const gw = Math.min(maxW, Math.max(1, Math.round(bw * scale)));
  const gh = Math.max(1, Math.round((bh / bw) * gw));
  return { gw, gh };
}

const clampInt = (v: number, max: number): number => (v < 0 ? 0 : v > max ? max : Math.floor(v));

/**
 * Map a CSS-px point (stage top-left origin) to a low-res grab cell.
 *
 * readPixels' origin is bottom-left while the DOM is top-left, so the grab buffer
 * stores rows bottom-up — the Y axis is FLIPPED here: a CSS y near 0 (visual top)
 * maps to the highest grab row index. Out-of-range points clamp to valid cells.
 */
export function cssToGrabCell(
  xCss: number,
  yCss: number,
  cssW: number,
  cssH: number,
  grabW: number,
  grabH: number,
): GrabCell {
  const w = cssW > 0 ? cssW : 1;
  const h = cssH > 0 ? cssH : 1;
  const col = clampInt((xCss / w) * grabW, grabW - 1);
  // Top-left CSS → top visual row → highest grab row (flip).
  const rowFromTop = clampInt((yCss / h) * grabH, grabH - 1);
  const row = grabH - 1 - rowFromTop;
  return { col, row };
}

/**
 * True when the cell (col,row) — or any of its 3×3 neighbors — has alpha at or
 * above `threshold255` in the RGBA grab. The dilation forgives the low-res grid
 * and thin silhouette features. Out-of-bounds neighbors are skipped; an
 * undersized/empty grab returns false.
 */
export function sampleAlphaHit(
  grab: Uint8Array,
  grabW: number,
  grabH: number,
  col: number,
  row: number,
  threshold255: number,
): boolean {
  if (grab.length < grabW * grabH * 4) return false;
  for (let dr = -1; dr <= 1; dr++) {
    const r = row + dr;
    if (r < 0 || r >= grabH) continue;
    for (let dc = -1; dc <= 1; dc++) {
      const c = col + dc;
      if (c < 0 || c >= grabW) continue;
      const alpha = grab[(r * grabW + c) * 4 + 3];
      if (alpha >= threshold255) return true;
    }
  }
  return false;
}
