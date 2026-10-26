import { describe, expect, it } from "vitest";
import { coercePhotoCrop, defaultCrop, faceCrop, wholeCrop } from "./photo-crop";

describe("framing presets", () => {
  it("defaultCrop takes the top square of a portrait and the centred square otherwise", () => {
    expect(defaultCrop({ width: 900, height: 1000 })).toEqual({ x: 0, y: 0, size: 1 });
    expect(defaultCrop({ width: 1000, height: 500 })).toEqual({ x: 0.25, y: 0, size: 0.5 });
  });

  it("faceCrop is 55% of the width, centred, 6% from the top", () => {
    const c = faceCrop({ width: 900, height: 1000 });
    expect(c.size).toBeCloseTo(0.55, 9);
    expect(c.x).toBeCloseTo(0.225, 9);
    expect(c.y).toBeCloseTo(0.06, 9);
  });

  it("wholeCrop is the largest centred square", () => {
    expect(wholeCrop({ width: 900, height: 1000 })).toEqual({ x: 0, y: 0.05, size: 1 });
  });
});

describe("coercePhotoCrop", () => {
  it("keeps a valid crop", () => {
    expect(coercePhotoCrop({ x: 0.2, y: 0.05, size: 0.5 })).toEqual({ x: 0.2, y: 0.05, size: 0.5 });
  });

  it.each([
    ["overflows the width", { x: 0.6, y: 0, size: 0.5 }],
    ["has zero size", { x: 0, y: 0, size: 0 }],
    ["has a string field", { x: "0", y: 0, size: 0.5 }],
    ["is not an object", 7],
  ])("drops a crop that %s", (_name, v) => {
    expect(coercePhotoCrop(v)).toBeUndefined();
  });
});
