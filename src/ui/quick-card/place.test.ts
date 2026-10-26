import { describe, expect, it } from "vitest";
import { placeCard } from "./place";

describe("placeCard", () => {
  it.each([
    ["opens at the click point when it fits", { x: 20, y: 30 }, { x: 20, y: 30 }],
    ["flips left past the right edge", { x: 350, y: 30 }, { x: 250, y: 30 }],
    ["flips above past the visible bottom", { x: 20, y: 550 }, { x: 20, y: 470 }],
  ])("%s", (_name, at, expected) => {
    expect(placeCard(at, { width: 100, height: 80 }, { width: 400, height: 600 })).toEqual(
      expected,
    );
  });

  it("flips above the visible bottom, not the window's", () => {
    expect(
      placeCard({ x: 20, y: 280 }, { width: 100, height: 80 }, { width: 400, height: 300 }),
    ).toEqual({ x: 20, y: 200 });
  });

  it("keeps a card sized to a 160×240 window 12px inside it", () => {
    expect(
      placeCard({ x: 100, y: 200 }, { width: 136, height: 216 }, { width: 160, height: 240 }),
    ).toEqual({ x: 12, y: 12 });
  });
});
