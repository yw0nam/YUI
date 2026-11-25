// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { waitRefit } from "./page-refit";

let frames = 0;

beforeEach(() => {
  frames = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames += 1;
    cb(0);
    return frames;
  });
});
afterEach(() => vi.unstubAllGlobals());

it("settles one frame after the page is within a pixel of the size, as a fractional scale leaves it", async () => {
  vi.stubGlobal("innerWidth", 401);
  vi.stubGlobal("innerHeight", 599);

  await waitRefit(400, 600);

  expect(frames).toBe(1);
});
