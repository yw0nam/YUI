import { describe, expect, it } from "vitest";
import { classifyTapRegion } from "./tap-region";

const bones = {
  chest: { x: 100, y: 100 },
  hips: { x: 100, y: 160 },
};

describe("classifyTapRegion", () => {
  it("selects the nearest bone within the configured character-height radius", () => {
    expect(classifyTapRegion({ x: 102, y: 105 }, bones, 200, 0.18)).toBe("chest");
    expect(classifyTapRegion({ x: 100, y: 150 }, bones, 200, 0.18)).toBe("hips");
  });

  it("includes points exactly on the radius boundary", () => {
    expect(classifyTapRegion({ x: 136, y: 100 }, bones, 200, 0.18)).toBe("chest");
  });

  it("breaks equal-distance ties toward chest", () => {
    expect(classifyTapRegion({ x: 100, y: 130 }, bones, 200, 0.18)).toBe("chest");
  });

  it("supports null bones and returns null when no available bone is in range", () => {
    expect(
      classifyTapRegion({ x: 100, y: 160 }, { chest: null, hips: bones.hips }, 200, 0.18),
    ).toBe("hips");
    expect(
      classifyTapRegion({ x: 100, y: 100 }, { chest: null, hips: null }, 200, 0.18),
    ).toBeNull();
    expect(classifyTapRegion({ x: 300, y: 300 }, bones, 200, 0.18)).toBeNull();
  });

  it("returns null for invalid dimensions instead of throwing", () => {
    expect(classifyTapRegion({ x: 100, y: 100 }, bones, Number.NaN, 0.18)).toBeNull();
    expect(classifyTapRegion({ x: 100, y: 100 }, bones, 200, 0)).toBeNull();
  });
});
