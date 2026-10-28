// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fitSheet } from "./fit-sheet";

function sheetAt(vh: number, top: number, height: number): HTMLElement {
  vi.stubGlobal("innerHeight", vh);
  const sheet = document.createElement("div");
  sheet.getBoundingClientRect = () => ({ top, height, bottom: top + height }) as DOMRect;
  return sheet;
}

afterEach(() => vi.unstubAllGlobals());

describe("fitSheet", () => {
  it.each([
    ["fits", 597, 314.3, 232.7, 0, ""],
    ["bottom past the window", 450, 270.2, 232.7, 60.9, ""],
    ["taller than the window", 200, 60, 245.7, 52, "184px"],
  ])("%s", (_name, vh, top, height, lift, maxHeight) => {
    const sheet = sheetAt(vh, top, height);

    fitSheet(sheet);

    const set = sheet.style.getPropertyValue("--yui-sigdetails-lift");
    if (lift === 0) expect(set).toBe("");
    else expect(Number.parseFloat(set)).toBeCloseTo(lift, 1);
    expect(sheet.style.maxHeight).toBe(maxHeight);
  });

  it("clears what the previous fit set before measuring again", () => {
    const sheet = sheetAt(200, 60, 245.7);
    fitSheet(sheet);

    const fits = sheetAt(597, 314.3, 232.7);
    sheet.getBoundingClientRect = fits.getBoundingClientRect;
    fitSheet(sheet);

    expect(sheet.style.getPropertyValue("--yui-sigdetails-lift")).toBe("");
    expect(sheet.style.maxHeight).toBe("");
  });
});
