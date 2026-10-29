/** threads-position.test.ts — where the Threads window sits beside the main pet window, and where its grow starts. */

import { expect, it } from "vitest";
import { chipInWindow, threadsWindowRect } from "./threads-position";

const WORK_AREA = { x: 0, y: 0, width: 2000, height: 1000 };

it.each([
  [
    "sits 12px right of the pet when the right side is roomier",
    { x: 200, y: 100, width: 400, height: 600 },
    WORK_AREA,
    { x: 612, y: 100, width: 960, height: 820 },
  ],
  [
    "sits 12px left of the pet when the left side is roomier",
    { x: 1500, y: 100, width: 400, height: 600 },
    WORK_AREA,
    { x: 528, y: 100, width: 960, height: 820 },
  ],
  [
    "clamps into the work area 12px from its edge",
    { x: 200, y: 400, width: 400, height: 600 },
    WORK_AREA,
    { x: 612, y: 168, width: 960, height: 820 },
  ],
  [
    "shrinks to the work area less 12px on each side",
    { x: 0, y: 0, width: 300, height: 500 },
    { x: 0, y: 0, width: 900, height: 700 },
    { x: 12, y: 12, width: 876, height: 676 },
  ],
])("%s", (_name, pet, workArea, expected) => {
  expect(threadsWindowRect({ pet, workArea })).toEqual(expected);
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
