/**
 * dock-position.test.ts — the shared dock's placement rules on their own: docked 12px beside the
 * roomier side, travelling with the owner window, the 24px magnet that snaps a dropped window
 * back, and the work-area clamp, on the quick card's margin box.
 */

import { describe, expect, it } from "vitest";
import {
  QUICK_CARD_GAP_PX,
  QUICK_CARD_MARGIN_PX,
  quickCardBeside,
  quickCardBox,
} from "../geometry/quick-card-position";
import { clampDock, followOwner, snapTarget } from "./dock-position";

/** One 2000×1000 logical work area starting at the origin. */
const WORK_AREA = { x: 0, y: 0, width: 2000, height: 1000 };
const CONTENT = { width: 272, height: 400 };
/** Her edges and the click's y, in screen logical px; roomy on both sides. */
const CHARACTER = { left: 500, right: 600, y: 300 };

describe("followOwner", () => {
  const docked = { x: 604, y: 268, side: "right" as const };

  it.each([
    [
      "moves a docked card by the owner's delta and keeps its side",
      { left: 600, right: 700, y: 300 },
      docked,
      { dx: 100, dy: 40 },
      { x: 704, y: 308, side: "right" },
    ],
    [
      "clamps the card back into the work area as she nears its bottom",
      { left: 600, right: 700, y: 990 },
      docked,
      { dx: 100, dy: 800 },
      { x: 704, y: 584, side: "right" },
    ],
    [
      "switches to the other side when the moved card would leave the work area",
      { left: 1656, right: 1756, y: 300 },
      { x: 1710, y: 268, side: "right" as const },
      { dx: 50, dy: 0 },
      { x: 1364, y: 268, side: "left" },
    ],
  ])("%s", (_name, character, card, delta, expected) => {
    expect(
      followOwner({
        window: card,
        delta,
        box: quickCardBox(CONTENT),
        bounds: WORK_AREA,
        beside: (side) =>
          quickCardBeside({ character, content: CONTENT, workArea: WORK_AREA, side }),
      }),
    ).toEqual(expected);
  });
});

describe("snapTarget", () => {
  const OWNER = { y: 0, height: 600 };

  it.each([
    // Visible right edge 200 + 288 - 8 = 480, 20px short of L = 500.
    [
      "snaps within 24px of her left edge onto her left",
      { x: 200, y: 100 },
      { x: 208, y: 100, side: "left" },
    ],
    // Visible left edge 612 + 8 = 620, 20px past R = 600.
    [
      "snaps within 24px of her right edge onto her right",
      { x: 612, y: 100 },
      { x: 604, y: 100, side: "right" },
    ],
    // Visible right edge 195 + 288 - 8 = 475, 25px short of L = 500.
    ["leaves a drop 25px from her edge detached", { x: 195, y: 100 }, null],
    ["leaves a drop beside her but clear of her window's span detached", { x: 200, y: 650 }, null],
    [
      "clamps the snapped card's kept top into the work area",
      { x: 200, y: -50 },
      { x: 208, y: 0, side: "left" },
    ],
  ])("%s", (_name, card, expected) => {
    expect(
      snapTarget({
        anchor: CHARACTER,
        owner: OWNER,
        dropped: card,
        box: quickCardBox(CONTENT),
        inset: QUICK_CARD_MARGIN_PX,
        gap: QUICK_CARD_GAP_PX,
        bounds: WORK_AREA,
      }),
    ).toEqual(expected);
  });
});

describe("clampDock", () => {
  it.each([
    ["keeps a window inside the work area where it is", { x: 100, y: 100 }, { x: 100, y: 100 }],
    [
      "pulls a window past the right and bottom edges back in",
      { x: 1900, y: 900 },
      { x: 1712, y: 584 },
    ],
    ["pulls a window past the left and top edges back in", { x: -40, y: -10 }, { x: 0, y: 0 }],
  ])("%s", (_name, at, expected) => {
    expect(clampDock(at, { width: 288, height: 416 }, WORK_AREA)).toEqual(expected);
  });
});
