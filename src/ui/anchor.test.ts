/**
 * anchor.test.ts — TDD red phase.
 *
 * Pins the pure mapping from the character's on-screen feet (px from top) to
 * the chat input's bottom offset (px from bottom): gapped just below the feet
 * and clamped so the input never leaves the viewport. Pure arithmetic — no DOM.
 */

import { describe, it, expect } from "vitest";
import {
  inputBottomFromAnchor,
  INPUT_FEET_GAP_PX,
  INPUT_ANCHOR_MIN_BOTTOM_PX,
} from "./anchor";

const opts = { gap: INPUT_FEET_GAP_PX, minBottom: INPUT_ANCHOR_MIN_BOTTOM_PX };
const H = 600;

describe("inputBottomFromAnchor", () => {
  it("feet near the bottom clamp to minBottom (never below the edge)", () => {
    // feetY at the very bottom → raw = -gap → clamps up to minBottom.
    expect(inputBottomFromAnchor(H, H, opts)).toBe(INPUT_ANCHOR_MIN_BOTTOM_PX);
  });

  it("feet mid-screen sit a gap below them (raw ≈ canvasH/2)", () => {
    // feetY = H/2 → raw = H/2 - gap.
    expect(inputBottomFromAnchor(H / 2, H, opts)).toBeCloseTo(H / 2 - INPUT_FEET_GAP_PX, 6);
  });

  it("feet above the top clamp to canvasH - minBottom (stays on screen)", () => {
    // feetY = -100 (above the canvas) → raw = H + 100 - gap > H → clamps down.
    expect(inputBottomFromAnchor(-100, H, opts)).toBe(H - INPUT_ANCHOR_MIN_BOTTOM_PX);
  });
});
