/**
 * quick-card-position.test.ts — the quick-card window's own placement rule on its own:
 * docked 12px beside the roomier side of the character. The follow, snap and clamp rules
 * it builds on are the shared dock's (dock-position.test.ts).
 */

import { describe, expect, it } from "vitest";
import { quickCardBeside } from "./quick-card-position";

/** One 2000×1000 logical work area starting at the origin. */
const WORK_AREA = { x: 0, y: 0, width: 2000, height: 1000 };
const CONTENT = { width: 272, height: 400 };
/** Her edges and the click's y, in screen logical px; roomy on both sides. */
const CHARACTER = { left: 500, right: 600, y: 300 };

describe("quickCardBeside", () => {
  it.each([
    [
      "docks right of R when the right side is roomier",
      CHARACTER,
      undefined,
      { x: 604, y: 268, side: "right" },
    ],
    [
      "docks left of L when the left side is roomier",
      { left: 1600, right: 1700, y: 300 },
      undefined,
      { x: 1308, y: 268, side: "left" },
    ],
    [
      "docks right on a tie",
      { left: 950, right: 1050, y: 300 },
      undefined,
      { x: 1054, y: 268, side: "right" },
    ],
    [
      "takes a forced side over the roomier one",
      CHARACTER,
      "left" as const,
      { x: 208, y: 268, side: "left" },
    ],
    [
      "clamps the top into the work area",
      { left: 500, right: 600, y: 10 },
      undefined,
      { x: 604, y: 0, side: "right" },
    ],
  ])("%s", (_name, character, side, expected) => {
    expect(quickCardBeside({ character, content: CONTENT, workArea: WORK_AREA, side })).toEqual(
      expected,
    );
  });
});
