/**
 * Tests for the attachment downscale math.
 *
 * The canvas/decode path needs a real browser; the pure long-edge fit math is
 * extracted so its behavior (cap, aspect-ratio preservation, never-upscale) is
 * unit-testable without a DOM.
 */

import { describe, expect, it } from "vitest";

import { fitLongEdge, MAX_LONG_EDGE } from "./image-resize";

describe("fitLongEdge — long-edge cap", () => {
  it("scales a landscape image so the long edge hits the cap", () => {
    expect(fitLongEdge(2560, 1440, 1280)).toEqual({ width: 1280, height: 720 });
  });

  it("scales a portrait image so the long edge hits the cap", () => {
    expect(fitLongEdge(1440, 2560, 1280)).toEqual({ width: 720, height: 1280 });
  });

  it("never upscales an image already within the cap", () => {
    expect(fitLongEdge(800, 600, 1280)).toEqual({ width: 800, height: 600 });
  });

  it("keeps native dims when the long edge equals the cap", () => {
    expect(fitLongEdge(1280, 960, 1280)).toEqual({ width: 1280, height: 960 });
  });

  it("rounds fractional scaled dims to whole pixels", () => {
    expect(fitLongEdge(1281, 901, 1280)).toEqual({ width: 1280, height: 900 });
  });

  it("defaults the cap to MAX_LONG_EDGE (1280)", () => {
    expect(MAX_LONG_EDGE).toBe(1280);
    expect(fitLongEdge(2560, 1280)).toEqual({ width: 1280, height: 640 });
  });
});
