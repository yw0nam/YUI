// @vitest-environment jsdom
/**
 * Tests for the attachment downscale math and the reject-on-failure contract.
 *
 * The canvas/decode path needs a real browser; the pure long-edge fit math is
 * extracted so its behavior (cap, aspect-ratio preservation, never-upscale) is
 * unit-testable without a DOM.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { downscaleToJpeg, fitLongEdge, MAX_LONG_EDGE } from "./image-resize";

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

describe("downscaleToJpeg — rejects instead of falling back", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function pngFile(): File {
    return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "broken.png", {
      type: "image/png",
    });
  }

  it("rejects when the file does not decode", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("undecodable")));

    await expect(downscaleToJpeg(pngFile())).rejects.toThrow("undecodable");
  });

  it("rejects when the canvas yields no jpeg data", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({ width: 10, height: 10, close() {} }));
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage() {} }),
          toDataURL: () => "data:,",
        } as unknown as HTMLCanvasElement;
      }
      return realCreate(tag);
    });

    await expect(downscaleToJpeg(pngFile())).rejects.toThrow();
  });
});
