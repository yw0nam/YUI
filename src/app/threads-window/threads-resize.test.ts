/** threads-resize.test.ts — a handle drag's screen deltas become the Threads window's box, clamped, applied once a frame, and saved at the end. */

import { expect, it, vi } from "vitest";
import type { ScreenRect } from "../../contract";
import { createThreadsResize } from "./threads-resize";

const BOX = { x: 500, y: 200, width: 896, height: 696 };
const WORK_AREA = { x: 0, y: 0, width: 2000, height: 1000 };

function controller() {
  const frames: (() => void)[] = [];
  const applied: ScreenRect[] = [];
  const save = vi.fn();
  const resize = createThreadsResize({
    current: async () => ({ box: BOX, workArea: WORK_AREA }),
    apply: async (box) => void applied.push(box),
    save,
    nextFrame: (cb) => void frames.push(cb),
  });
  const runFrames = () => {
    for (const cb of frames.splice(0)) cb();
  };
  return { resize, applied, save, runFrames };
}

it.each([
  ["the east edge moves the right side", "e", 100, 0, { ...BOX, width: 996 }],
  ["the west edge moves the left side", "w", -100, 0, { ...BOX, x: 400, width: 996 }],
  ["the north edge moves the top", "n", 0, -50, { ...BOX, y: 150, height: 746 }],
  ["the south edge moves the bottom", "s", 0, 50, { ...BOX, height: 746 }],
  ["a corner moves both of its sides", "nw", -50, -40, { x: 450, y: 160, width: 946, height: 736 }],
  ["stops at the minimum box", "e", -1000, 0, { ...BOX, width: 376 }],
  ["stops the top at the minimum box", "n", 0, 1000, { ...BOX, y: 460, height: 436 }],
  ["stops at the work area less 12px", "e", 5000, 0, { ...BOX, width: 1488 }],
  ["stops the left side at the work area less 12px", "w", -5000, 0, { ...BOX, x: 12, width: 1384 }],
] as const)("%s", async (_name, edge, dx, dy, expected) => {
  const { resize, applied, save } = controller();

  resize.start();
  resize.move(edge, dx, dy);
  await resize.end();

  expect(applied).toEqual([expected]);
  expect(save).toHaveBeenCalledOnce();
});

it("applies only the latest move of a frame, and the last one before it saves", async () => {
  const { resize, applied, save, runFrames } = controller();

  resize.start();
  resize.move("e", 10, 0);
  resize.move("e", 20, 0);
  runFrames();
  await vi.waitFor(() => expect(applied.map((box) => box.width)).toEqual([916]));
  resize.move("e", 30, 0);
  resize.move("e", 40, 0);
  await resize.end();

  expect(applied.map((box) => box.width)).toEqual([916, 936]);
  expect(save).toHaveBeenCalledOnce();
});
