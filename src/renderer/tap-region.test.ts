import { describe, expect, it } from "vitest";
import { classifyTapRegion } from "./tap-region";

const bones = {
  head: { x: 100, y: 40 },
  chest: { x: 100, y: 100 },
  hips: { x: 100, y: 160 },
};

describe("classifyTapRegion", () => {
  it("selects the nearest bone within the configured character-height radius", () => {
    expect(classifyTapRegion({ x: 102, y: 42 }, bones, 200, 0.18)).toBe("head");
    expect(classifyTapRegion({ x: 102, y: 105 }, bones, 200, 0.18)).toBe("chest");
    expect(classifyTapRegion({ x: 100, y: 150 }, bones, 200, 0.18)).toBe("hips");
  });

  it("includes points exactly on the radius boundary", () => {
    expect(classifyTapRegion({ x: 136, y: 100 }, bones, 200, 0.18)).toBe("chest");
  });

  it("breaks equal-distance ties toward the upper region", () => {
    expect(classifyTapRegion({ x: 100, y: 70 }, bones, 200, 0.18)).toBe("head");
    expect(classifyTapRegion({ x: 100, y: 130 }, bones, 200, 0.18)).toBe("chest");
  });

  it("supports null bones and returns null when no available bone is in range", () => {
    expect(
      classifyTapRegion(
        { x: 100, y: 160 },
        { head: null, chest: null, hips: bones.hips },
        200,
        0.18,
      ),
    ).toBe("hips");
    expect(
      classifyTapRegion({ x: 100, y: 40 }, { head: null, chest: null, hips: null }, 200, 0.18),
    ).toBeNull();
    expect(
      classifyTapRegion(
        { x: 100, y: 40 },
        { head: null, chest: bones.chest, hips: null },
        200,
        0.18,
      ),
    ).toBeNull();
    expect(classifyTapRegion({ x: 300, y: 300 }, bones, 200, 0.18)).toBeNull();
  });

  it("returns null for invalid dimensions instead of throwing", () => {
    expect(classifyTapRegion({ x: 100, y: 100 }, bones, Number.NaN, 0.18)).toBeNull();
    expect(classifyTapRegion({ x: 100, y: 100 }, bones, 200, 0)).toBeNull();
  });
});
