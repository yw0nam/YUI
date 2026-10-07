/**
 * stationary-frame.test.ts — widening the real window around a character that stays put.
 *
 * Reference layout: a 400×600 logical window at (300, 517) on a scale-2 display.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Renderer } from "../../../renderer";
import { createStationaryFrame, framePadding } from "./stationary-frame";
import type { FrameWindow } from "./travel-frame";

/** 350 px left and 250 px right of a character at canvas x 200: pads 150 left, 50 right. */
const EXTENTS = { leftPx: 350, rightPx: 250, anchorX: 200 };

describe("framePadding", () => {
  it("pads only the side the extents overflow", () => {
    expect(framePadding(EXTENTS, 400)).toEqual({ left: 150, right: 50 });
    expect(framePadding({ leftPx: 350, rightPx: 100, anchorX: 200 }, 400)).toEqual({
      left: 150,
      right: 0,
    });
    expect(framePadding({ leftPx: 100, rightPx: 100, anchorX: 200 }, 400)).toEqual({
      left: 0,
      right: 0,
    });
  });
});

describe("createStationaryFrame", () => {
  let live: { x: number; y: number; width: number; height: number; scale: number };
  let setFrameLogical: ReturnType<typeof vi.fn<FrameWindow["setFrameLogical"]>>;
  let setViewWindow: ReturnType<typeof vi.fn<Renderer["setViewWindow"]>>;
  let setKeepOnScreenPaused: ReturnType<typeof vi.fn<(paused: boolean) => void>>;

  beforeEach(() => {
    live = { x: 300, y: 517, width: 400, height: 600, scale: 2 };
    // The fake applies the frame the way the OS does, so a later read sees the wide window.
    setFrameLogical = vi.fn<FrameWindow["setFrameLogical"]>(async (x, y, width, height) => {
      live = { ...live, x, y, width, height };
    });
    setViewWindow = vi.fn<Renderer["setViewWindow"]>(() => {});
    setKeepOnScreenPaused = vi.fn<(paused: boolean) => void>(() => {});
  });

  function make() {
    return createStationaryFrame({
      frame: {
        outerPosition: async () => ({ x: live.x * live.scale, y: live.y * live.scale }),
        outerSize: async () => ({
          width: live.width * live.scale,
          height: live.height * live.scale,
        }),
        scaleFactor: async () => live.scale,
        setPositionLogical: async () => {},
        setFrameLogical,
      },
      renderer: { setViewWindow },
      setKeepOnScreenPaused,
    });
  }

  it("parks the widened frame with the bottom edge kept and offsets the view by the left padding", async () => {
    const frame = make();

    await frame.park(EXTENTS);

    expect(setFrameLogical).toHaveBeenCalledExactlyOnceWith(150, 517, 600, 600);
    expect(setViewWindow).toHaveBeenCalledExactlyOnceWith({ x: 150, y: 0, width: 400, height: 600 });
    expect(setKeepOnScreenPaused).toHaveBeenCalledExactlyOnceWith(true);
    expect(frame.isParked()).toBe(true);
  });

  it("releases the normal-size window at the live origin plus the left padding and clears the view", async () => {
    const frame = make();
    await frame.park(EXTENTS);
    // A drag during the scene moved the wide window.
    live = { ...live, x: 500, y: 400 };

    await frame.release();

    expect(setFrameLogical).toHaveBeenLastCalledWith(650, 400, 400, 600);
    expect(setViewWindow).toHaveBeenLastCalledWith(null);
    expect(setKeepOnScreenPaused).toHaveBeenLastCalledWith(false);
    expect(frame.isParked()).toBe(false);
  });

  it("unparks a park still in flight once it lands", async () => {
    let land!: () => void;
    setFrameLogical.mockImplementationOnce(
      (x, y, width, height) =>
        new Promise<void>((resolve) => {
          land = () => {
            live = { ...live, x, y, width, height };
            resolve();
          };
        }),
    );
    const frame = make();

    const parking = frame.park(EXTENTS);
    const releasing = frame.release();
    await vi.waitFor(() => expect(setFrameLogical).toHaveBeenCalledTimes(1));
    expect(frame.release()).toBe(releasing);

    land();
    await parking;
    await releasing;

    expect(setFrameLogical).toHaveBeenCalledTimes(2);
    expect(setFrameLogical).toHaveBeenLastCalledWith(300, 517, 400, 600);
    expect(setViewWindow).toHaveBeenLastCalledWith(null);
    expect(setKeepOnScreenPaused).toHaveBeenLastCalledWith(false);
  });

  it("re-issues the parked size on a refit only when the live size drifted", async () => {
    const frame = make();
    await frame.park(EXTENTS);
    live = { ...live, x: 500, y: 400 };

    await frame.refit();
    expect(setFrameLogical).toHaveBeenCalledTimes(1);
    expect(setViewWindow).toHaveBeenCalledTimes(2);

    // Dropped across a scale seam: the same physical size reads as twice the logical one.
    live = { ...live, x: 1000, y: 800, width: 1200, height: 1200, scale: 1 };
    await frame.refit();

    expect(setFrameLogical).toHaveBeenLastCalledWith(1000, 800, 600, 600);
    expect(setViewWindow).toHaveBeenLastCalledWith({ x: 150, y: 0, width: 400, height: 600 });
  });
});
