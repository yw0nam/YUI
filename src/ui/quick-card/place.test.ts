import { describe, expect, it } from "vitest";
import { placeCard } from "./place";

const CARD = { width: 100, height: 80 };
const WINDOW = { width: 400, height: 600 };

describe("placeCard", () => {
  it.each([
    ["opens at the click point when it fits", { x: 20, y: 30 }, CARD, WINDOW, { x: 20, y: 30 }],
    ["flips left past the right edge", { x: 350, y: 30 }, CARD, WINDOW, { x: 250, y: 30 }],
    ["flips above past the visible bottom", { x: 20, y: 550 }, CARD, WINDOW, { x: 20, y: 470 }],
    [
      "flips above the visible bottom, not the window's",
      { x: 20, y: 280 },
      CARD,
      { width: 400, height: 300 },
      { x: 20, y: 200 },
    ],
    [
      "keeps a card sized to a 160×240 window 12px inside it",
      { x: 100, y: 200 },
      { width: 136, height: 216 },
      { width: 160, height: 240 },
      { x: 12, y: 12 },
    ],
  ])("%s", (_name, at, card, view, expected) => {
    expect(placeCard(at, card, view)).toEqual(expected);
  });
});
