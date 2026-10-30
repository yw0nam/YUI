/** threads-position.test.ts — where the Threads window first opens beside the pet window, where a stored frame reopens, and where its grow starts. */

import { describe, expect, it } from "vitest";
import { chipInWindow, restoreThreadsBox, threadsWindowRect } from "./threads-position";

const WORK_AREA = { x: 0, y: 0, width: 2000, height: 1000 };
const PANEL = { width: 880, height: 680 };

describe("threadsWindowRect", () => {
  it.each([
    [
      "sits 12px right of the pet when the right side is roomier",
      { x: 200, y: 100, width: 400 },
      WORK_AREA,
      { x: 612, y: 100, width: 896, height: 696 },
    ],
    [
      "sits 12px left of the pet when the left side is roomier",
      { x: 1500, y: 100, width: 400 },
      WORK_AREA,
      { x: 592, y: 100, width: 896, height: 696 },
    ],
    [
      "narrows to the room on the roomier side",
      { x: 500, y: 100, width: 400 },
      { x: 0, y: 0, width: 1600, height: 1000 },
      { x: 912, y: 100, width: 676, height: 696 },
    ],
    [
      "keeps the minimum and clamps over her when neither side holds it",
      { x: 300, y: 100, width: 400 },
      { x: 0, y: 0, width: 1000, height: 1000 },
      { x: 612, y: 100, width: 376, height: 696 },
    ],
    [
      "clamps into the work area 12px from its edge",
      { x: 200, y: 400, width: 400 },
      WORK_AREA,
      { x: 612, y: 292, width: 896, height: 696 },
    ],
    [
      "caps the height at the work area less 12px on each side",
      { x: 0, y: 0, width: 300 },
      { x: 0, y: 0, width: 900, height: 700 },
      { x: 312, y: 12, width: 576, height: 676 },
    ],
    [
      "takes the work area less 12px when it cannot hold the minimum",
      { x: 0, y: 0, width: 100 },
      { x: 0, y: 0, width: 300, height: 400 },
      { x: 12, y: 12, width: 276, height: 376 },
    ],
  ])("%s", (_name, pet, workArea, expected) => {
    expect(threadsWindowRect({ pet, workArea, panel: PANEL })).toEqual(expected);
  });
});

const monitor = (x: number, y: number, width: number, height: number, scaleFactor = 1) => ({
  position: { x, y },
  size: { width, height },
  workArea: { position: { x, y }, size: { width, height } },
  scaleFactor,
});
const MAIN = monitor(0, 0, 2000, 1000);

describe("restoreThreadsBox", () => {
  it.each([
    [
      "reopens a stored frame as it was",
      { x: 408, y: 208, width: 880, height: 680 },
      [MAIN],
      { x: 400, y: 200, width: 896, height: 696 },
    ],
    [
      "moves a frame off every monitor into the nearest one",
      { x: 3008, y: 208, width: 880, height: 680 },
      [MAIN],
      { x: 1092, y: 200, width: 896, height: 696 },
    ],
    [
      "clamps into a monitor left of the primary, at a negative origin",
      { x: -2500, y: 100, width: 880, height: 680 },
      [MAIN, monitor(-1920, 0, 1920, 1080)],
      { x: -1908, y: 92, width: 896, height: 696 },
    ],
    [
      // The Retina work area is 1440 × 875 logical px from (2000, 25), not 2880 × 1750.
      "clamps by a monitor's logical work area at its own scale",
      { x: 2208, y: 108, width: 880, height: 800 },
      [
        MAIN,
        {
          position: { x: 4000, y: 0 },
          size: { width: 2880, height: 1800 },
          workArea: { position: { x: 4000, y: 50 }, size: { width: 2880, height: 1750 } },
          scaleFactor: 2,
        },
      ],
      { x: 2200, y: 72, width: 896, height: 816 },
    ],
    [
      "shrinks an oversized frame to the work area less 12px on each side",
      { x: 108, y: 108, width: 2400, height: 1200 },
      [MAIN],
      { x: 12, y: 12, width: 1976, height: 976 },
    ],
  ])("%s", (_name, panel, monitors, expected) => {
    expect(restoreThreadsBox(panel, monitors)).toEqual(expected);
  });
});

it("starts the grow from the chip's size at the window edge nearest the chip", () => {
  const window = { x: 612, y: 100, width: 960, height: 820 };

  expect(chipInWindow({ x: 500, y: 300, width: 120, height: 32 }, window)).toEqual({
    x: 0,
    y: 200,
    width: 120,
    height: 32,
  });
});
