import { describe, expect, it } from "vitest";
import { clampPixelRatio } from "./pixel-ratio";

describe("clampPixelRatio", () => {
  it("passes through ratios at or below the cap", () => {
    expect(clampPixelRatio(1)).toBe(1);
    expect(clampPixelRatio(2)).toBe(2);
  });

  it("clamps HiDPI ratios above the cap to 2", () => {
    expect(clampPixelRatio(3)).toBe(2);
    expect(clampPixelRatio(2.5)).toBe(2);
  });
});
