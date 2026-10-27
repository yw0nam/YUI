/**
 * quick-card-position.test.ts — the quick-card window's placement rules on their own:
 * docked 12px beside the roomier side of the character, travelling with her window,
 * and the magnet that snaps a dropped card back within 24px of her edge.
 */

import { describe, expect, it } from "vitest";
import { followOwner, quickCardBeside, snapTarget } from "./quick-card-position";

/** One 2000×1000 logical work area starting at the origin. */
const WORK_AREA = { x: 0, y: 0, width: 2000, height: 1000 };
const CARD = { width: 272, height: 400 };
const MARGIN = 8;
/** Her edges and the click's y, in screen logical px; roomy on both sides. */
const CHARACTER = { left: 500, right: 600, y: 300 };

describe("quickCardBeside", () => {
  it("docks right of R when the right side is roomier", () => {
    expect(quickCardBeside({ character: CHARACTER, window: CARD, margin: MARGIN, workArea: WORK_AREA })).toEqual({
      x: 604,
      y: 268,
      side: "right",
    });
  });

  it("docks left of L when the left side is roomier", () => {
    const character = { left: 1600, right: 1700, y: 300 };
    expect(quickCardBeside({ character, window: CARD, margin: MARGIN, workArea: WORK_AREA })).toEqual({
      x: 1308,
      y: 268,
      side: "left",
    });
  });

  it("docks right on a tie", () => {
    const character = { left: 950, right: 1050, y: 300 };
    expect(quickCardBeside({ character, window: CARD, margin: MARGIN, workArea: WORK_AREA }).side).toBe("right");
  });

  it("takes a forced side over the roomier one", () => {
    expect(
      quickCardBeside({ character: CHARACTER, window: CARD, margin: MARGIN, workArea: WORK_AREA, side: "left" }),
    ).toEqual({ x: 208, y: 268, side: "left" });
  });

  it("clamps the top into the work area", () => {
    const character = { left: 500, right: 600, y: 10 };
    expect(quickCardBeside({ character, window: CARD, margin: MARGIN, workArea: WORK_AREA }).y).toBe(0);
  });
});

describe("followOwner", () => {
  const docked = { x: 604, y: 268, side: "right" as const };

  it("moves a docked card by the owner's delta and keeps its side", () => {
    const character = { left: 600, right: 700, y: 300 };
    expect(
      followOwner({
        character,
        card: docked,
        delta: { dx: 100, dy: 40 },
        window: CARD,
        margin: MARGIN,
        workArea: WORK_AREA,
      }),
    ).toEqual({ x: 704, y: 308, side: "right" });
  });

  it("clamps the card back into the work area as she nears its bottom", () => {
    const character = { left: 600, right: 700, y: 990 };
    expect(
      followOwner({
        character,
        card: docked,
        delta: { dx: 100, dy: 800 },
        window: CARD,
        margin: MARGIN,
        workArea: WORK_AREA,
      }).y,
    ).toBe(WORK_AREA.height - CARD.height - MARGIN * 2);
  });

  it("switches to the other side when the moved card would leave the work area", () => {
    const character = { left: 1656, right: 1756, y: 300 };
    const card = { x: 1710, y: 268, side: "right" as const };
    expect(
      followOwner({
        character,
        card,
        delta: { dx: 50, dy: 0 },
        window: CARD,
        margin: MARGIN,
        workArea: WORK_AREA,
      }),
    ).toEqual({ x: 1364, y: 268, side: "left" });
  });
});

describe("snapTarget", () => {
  const OWNER = { y: 0, height: 600 };

  it("snaps a card dropped within 24px of her left edge onto her left", () => {
    // Visible right edge 200 + 288 - 8 = 480, 20px short of L = 500.
    expect(
      snapTarget({
        character: CHARACTER,
        owner: OWNER,
        card: { x: 200, y: 100 },
        window: CARD,
        margin: MARGIN,
        workArea: WORK_AREA,
      }),
    ).toEqual({ x: 208, y: 100, side: "left" });
  });

  it("snaps a card dropped within 24px of her right edge onto her right", () => {
    // Visible left edge 612 + 8 = 620, 20px past R = 600.
    expect(
      snapTarget({
        character: CHARACTER,
        owner: OWNER,
        card: { x: 612, y: 100 },
        window: CARD,
        margin: MARGIN,
        workArea: WORK_AREA,
      }),
    ).toEqual({ x: 604, y: 100, side: "right" });
  });

  it("leaves a card dropped 25px from her edge detached", () => {
    // Visible right edge 195 + 288 - 8 = 475, 25px short of L = 500.
    expect(
      snapTarget({
        character: CHARACTER,
        owner: OWNER,
        card: { x: 195, y: 100 },
        window: CARD,
        margin: MARGIN,
        workArea: WORK_AREA,
      }),
    ).toBeNull();
  });

  it("leaves a card dropped beside her but clear of her window's span detached", () => {
    expect(
      snapTarget({
        character: CHARACTER,
        owner: OWNER,
        card: { x: 200, y: 650 },
        window: CARD,
        margin: MARGIN,
        workArea: WORK_AREA,
      }),
    ).toBeNull();
  });

  it("clamps the snapped card's kept top into the work area", () => {
    expect(
      snapTarget({
        character: CHARACTER,
        owner: OWNER,
        card: { x: 200, y: -50 },
        window: CARD,
        margin: MARGIN,
        workArea: WORK_AREA,
      }),
    ).toEqual({ x: 208, y: 0, side: "left" });
  });
});
