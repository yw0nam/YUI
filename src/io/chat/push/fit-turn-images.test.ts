// @vitest-environment jsdom
/** fit-turn-images.test.ts — a turn's images are shrunk to the byte budget the backend stated. */

import { afterEach, describe, expect, it, vi } from "vitest";

import { fitTurnImages } from "./fit-turn-images";

describe("fitTurnImages", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns images within the budget unchanged and decodes nothing", async () => {
    const createImageBitmap = vi.fn();
    vi.stubGlobal("createImageBitmap", createImageBitmap);
    const images = ["data:image/png;base64,AAAA", "data:image/png;base64,BBBB"];

    expect(await fitTurnImages(images, 100)).toBe(images);
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it("re-encodes an image over its share and leaves the small one alone", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 1000, height: 1000, close() {} }),
    );
    const realCreate = document.createElement.bind(document);
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage() {} }),
      toDataURL: () => "data:image/jpeg;base64,jjjjjjjjjjjjjj",
    };
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") return canvas as unknown as HTMLCanvasElement;
      return realCreate(tag);
    });

    const small = "data:image/png;base64,BBBBBBBBBB";
    const large = `data:image/png;base64,${"A".repeat(1000)}`;
    const result = await fitTurnImages([small, large], 200);

    expect(result[0]).toBe(small);
    expect(result[1]).toBe("data:image/jpeg;base64,jjjjjjjjjjjjjj");
    expect(canvas.width).toBeGreaterThan(0);
    expect(canvas.width).toBeLessThan(1000);
  });
});
