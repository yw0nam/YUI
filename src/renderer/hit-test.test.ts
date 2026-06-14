/**
 * hit-test.test.ts — PHASE-2 per-pixel alpha silhouette predicate.
 *
 * Pins the PURE parts of the alpha-based hit test (no GL):
 *  - cssToGrabCell: CSS-px (stage top-left origin) → low-res grab cell, with the
 *    Y-FLIP that maps DOM top-left to readPixels' bottom-left grab origin.
 *  - sampleAlphaHit: alpha-threshold decision with 3×3 dilation against a small
 *    synthetic RGBA grab grid.
 */

import { describe, expect, it } from "vitest";
import { cssToGrabCell, sampleAlphaHit } from "./hit-test";

/**
 * Build an RGBA Uint8Array grab of size gw×gh where `opaque(col,row)` decides the
 * alpha (255 opaque / 0 transparent). Grab rows are bottom-up (readPixels origin),
 * so row 0 is the bottom of the image.
 */
function makeGrab(
  gw: number,
  gh: number,
  opaque: (col: number, row: number) => boolean,
): Uint8Array {
  const buf = new Uint8Array(gw * gh * 4);
  for (let row = 0; row < gh; row++) {
    for (let col = 0; col < gw; col++) {
      const i = (row * gw + col) * 4;
      buf[i + 3] = opaque(col, row) ? 255 : 0;
    }
  }
  return buf;
}

describe("cssToGrabCell — CSS px → low-res grab cell with Y-flip", () => {
  it("top-left CSS corner maps to the TOP grab row (= grab row gh-1, the flip)", () => {
    // CSS (0,0) is the visual top-left. readPixels row 0 is the bottom, so the
    // top visual row must map to the highest grab row index.
    const cell = cssToGrabCell(0, 0, 100, 200, 10, 20);
    expect(cell.col).toBe(0);
    expect(cell.row).toBe(19);
  });

  it("bottom-left CSS corner maps to grab row 0 (the bottom of the buffer)", () => {
    const cell = cssToGrabCell(0, 199, 100, 200, 10, 20);
    expect(cell.col).toBe(0);
    expect(cell.row).toBe(0);
  });

  it("center CSS maps to center cell", () => {
    const cell = cssToGrabCell(50, 100, 100, 200, 10, 20);
    expect(cell.col).toBe(5);
    // row 100/200*20 = 10 from the top → flipped to 20-1-10 = 9.
    expect(cell.row).toBe(9);
  });

  it("clamps out-of-range CSS points to valid cells", () => {
    const past = cssToGrabCell(1000, -50, 100, 200, 10, 20);
    expect(past.col).toBe(9);
    expect(past.row).toBe(19);
  });
});

describe("sampleAlphaHit — threshold + 3×3 dilation", () => {
  const gw = 8;
  const gh = 8;
  // A single opaque cell at (col=4, row=4); everything else transparent.
  const grab = makeGrab(gw, gh, (c, r) => c === 4 && r === 4);
  const threshold255 = 26; // 0.1 * 255 ≈ 26.

  it("point ON an opaque cell → true", () => {
    expect(sampleAlphaHit(grab, gw, gh, 4, 4, threshold255)).toBe(true);
  });

  it("point in a transparent gap surrounded by transparent → false", () => {
    expect(sampleAlphaHit(grab, gw, gh, 0, 0, threshold255)).toBe(false);
    expect(sampleAlphaHit(grab, gw, gh, 7, 7, threshold255)).toBe(false);
  });

  it("dilation catches a 1-cell-away opaque neighbor", () => {
    // (3,4) and (5,5) are within the 3×3 neighborhood of the opaque (4,4).
    expect(sampleAlphaHit(grab, gw, gh, 3, 4, threshold255)).toBe(true);
    expect(sampleAlphaHit(grab, gw, gh, 5, 5, threshold255)).toBe(true);
  });

  it("a 2-cells-away point stays false (dilation is only 3×3)", () => {
    expect(sampleAlphaHit(grab, gw, gh, 6, 4, threshold255)).toBe(false);
  });

  it("alpha below threshold does not register", () => {
    const faint = makeGrab(gw, gh, () => false);
    faint[(4 * gw + 4) * 4 + 3] = 10; // below 26.
    expect(sampleAlphaHit(faint, gw, gh, 4, 4, threshold255)).toBe(false);
  });

  it("empty / undersized grab → false", () => {
    expect(sampleAlphaHit(new Uint8Array(0), gw, gh, 4, 4, threshold255)).toBe(false);
  });
});
