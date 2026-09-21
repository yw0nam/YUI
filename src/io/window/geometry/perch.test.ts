import { describe, expect, it } from "vitest";
import type { WindowRect } from "../../../contract";
import { uncoveredSpan } from "./perch";

/** A window whose top edge a perched walk runs along. */
const SPAN_HOST: WindowRect = {
  x: 1000,
  y: 900,
  width: 500,
  height: 600,
  name: "Other",
  ownerName: "Visual Studio Code",
  pid: 999,
  windowNumber: 42,
};

/** A window reaching across the host's top edge (y 900) at the given x span. */
function spanCover(x: number, width: number, windowNumber: number): WindowRect {
  return { ...SPAN_HOST, x, y: 800, width, height: 400, name: "Cover", windowNumber };
}

describe("uncoveredSpan", () => {
  it("keeps the whole host edge when nothing in front reaches it", () => {
    const below = { ...spanCover(1300, 300, 7), y: 1000 };
    expect(uncoveredSpan([below, SPAN_HOST], 1, 1200)).toEqual({ left: 1000, right: 1500 });
    expect(uncoveredSpan([spanCover(2000, 300, 8), SPAN_HOST], 1, 1200)).toEqual({
      left: 1000,
      right: 1500,
    });
  });

  it("clips to the nearest covering window on each side of the given x", () => {
    expect(
      uncoveredSpan([spanCover(900, 200, 7), spanCover(1310, 200, 8), SPAN_HOST], 2, 1200),
    ).toEqual({
      left: 1100,
      right: 1310,
    });
  });

  it("ignores windows behind the host", () => {
    expect(uncoveredSpan([SPAN_HOST, spanCover(1300, 300, 7)], 0, 1200)).toEqual({
      left: 1000,
      right: 1500,
    });
  });

  it("leaves no span at all when the x itself is covered", () => {
    const span = uncoveredSpan([spanCover(1150, 200, 7), SPAN_HOST], 1, 1200);
    expect(span.left).toBeGreaterThan(span.right);
  });
});
