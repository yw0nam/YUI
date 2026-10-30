/**
 * dock-position.test.ts — the shared dock's placement rules on their own: docked 12px beside the
 * roomier side, travelling with the owner window, the 24px magnet that snaps a dropped window
 * back, and the work-area clamp — on the quick card's margin box, and the magnet also on the
 * Threads window's panel inset.
 */

import { describe, expect, it } from "vitest";
import {
  QUICK_CARD_GAP_PX,
  QUICK_CARD_MARGIN_PX,
  quickCardBeside,
  quickCardBox,
} from "../geometry/quick-card-position";
import { clampDock, followOwner, insetWorkArea, snapTarget } from "./dock-position";

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

describe("snapTarget on the Threads window's panel inset", () => {
  // The panel sits 8px inside the native box, and the native box keeps 12px from the work area.
  const BOX = { width: 960, height: 820 };
  const INSET = 8;
  const GAP = 20; // The native 12px gap plus the 8px padding, in visible-edge terms.
  const BOUNDS = insetWorkArea(WORK_AREA, 12);
  const PET = { left: 500, right: 900, y: 100 };
  const OWNER = { y: 100, height: 600 };

  it.each([
    // Visible panel left edge 910 + 8 = 918, 18px past her window's right edge 900.
    [
      "snaps a drop by its visible panel edge onto the native 12px dock",
      { x: 910, y: 100 },
      { x: 912, y: 100, side: "right" },
    ],
    // Visible panel left edge 890 + 8 = 898, 2px short of her right edge — but the kept top
    // clamps into the bounds 12px inside the work area, not onto its edge.
    [
      "keeps the snapped window 12px inside the work area",
      { x: 890, y: 400 },
      { x: 912, y: 168, side: "right" },
    ],
    // Visible panel left edge 917 + 8 = 925, 25px past her window's right edge 900.
    ["leaves a drop 25px from her window's edge detached", { x: 917, y: 100 }, null],
  ])("%s", (_name, dropped, expected) => {
    expect(
      snapTarget({
        anchor: PET,
        owner: OWNER,
        dropped,
        box: BOX,
        inset: INSET,
        gap: GAP,
        bounds: BOUNDS,
      }),
    ).toEqual(expected);
  });
});
