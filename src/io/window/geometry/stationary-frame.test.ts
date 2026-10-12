/**
 * stationary-frame.test.ts — widening the real window around a character that stays put.
 *
 * Reference layout: a 400×600 logical window at (300, 517) on a scale-2 display.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Renderer } from "../../../renderer";
import type { ScreenMonitor } from "./screen-geometry";
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
    expect(framePadding({ leftPx: 350.4, rightPx: 250.2, anchorX: 200 }, 400)).toEqual({
      left: 151,
      right: 51,
    });
  });
});

/** A 1440×900 logical screen at the origin on a scale-2 display. */
const SCREEN: ScreenMonitor = {
  position: { x: 0, y: 0 },
  size: { width: 2880, height: 1800 },
  workArea: { position: { x: 0, y: 0 }, size: { width: 2880, height: 1800 } },
  scaleFactor: 2,
};

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

  function make(monitors: ScreenMonitor[] = [SCREEN]) {
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
      listMonitors: async () => monitors,
      setKeepOnScreenPaused,
    });
  }

  it("parks the widened frame with the bottom edge kept and offsets the view by the left padding", async () => {
    const frame = make();

    await frame.park(EXTENTS);

    expect(setFrameLogical).toHaveBeenCalledExactlyOnceWith(150, 517, 600, 600);
    expect(setViewWindow).toHaveBeenCalledExactlyOnceWith({
      x: 150,
      y: 0,
      width: 400,
      height: 600,
    });
    expect(setKeepOnScreenPaused).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("pulls the widened frame inside the screen at the right edge and keeps the view offset", async () => {
    live = { ...live, x: 1040 };
    const frame = make();

    await frame.park(EXTENTS);

    // Unclamped 890..1490 overflows the 1440 edge by 50; she moves in by as much.
    expect(setFrameLogical).toHaveBeenCalledExactlyOnceWith(840, 517, 600, 600);
    expect(setViewWindow).toHaveBeenCalledExactlyOnceWith({
      x: 150,
      y: 0,
      width: 400,
      height: 600,
    });

    await frame.release();

    expect(setFrameLogical).toHaveBeenLastCalledWith(990, 517, 400, 600);
  });

  it("clamps to the bounds of the monitor the window is on when it is not at the origin", async () => {
    const right: ScreenMonitor = { ...SCREEN, position: { x: 2560, y: 0 } };
    // Logical 1280..2720; the window's right edge sits at 2700.
    live = { ...live, x: 2300 };
    const frame = make([SCREEN, right]);

    await frame.park(EXTENTS);

    // Unclamped 2150..2750 overflows the 2720 edge by 30.
    expect(setFrameLogical).toHaveBeenCalledExactlyOnceWith(2120, 517, 600, 600);
  });

  it("leaves the frame unclamped when the window center is on no monitor", async () => {
    const frame = make([]);

    await frame.park(EXTENTS);

    expect(setFrameLogical).toHaveBeenCalledExactlyOnceWith(150, 517, 600, 600);
  });

  it("pulls the widened frame inside the screen at the left edge", async () => {
    live = { ...live, x: 20 };
    const frame = make();

    await frame.park(EXTENTS);

    expect(setFrameLogical).toHaveBeenCalledExactlyOnceWith(0, 517, 600, 600);
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

  it("leaves the view cleared when a release lands during a refit's re-issue", async () => {
    const frame = make();
    await frame.park(EXTENTS);
    live = { ...live, width: 1200, height: 1200, scale: 1 };
    let land!: () => void;
    setFrameLogical.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          land = resolve;
        }),
    );

    const refitting = frame.refit();
    await vi.waitFor(() => expect(setFrameLogical).toHaveBeenCalledTimes(2));
    await frame.release();
    land();
    await refitting;

    expect(setViewWindow).toHaveBeenLastCalledWith(null);
  });

  it("parks again only after a release in flight has landed", async () => {
    const frame = make();
    await frame.park(EXTENTS);
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

    const releasing = frame.release();
    await vi.waitFor(() => expect(setFrameLogical).toHaveBeenCalledTimes(2));
    const parking = frame.park(EXTENTS);
    land();
    await releasing;
    await parking;

    expect(setFrameLogical).toHaveBeenLastCalledWith(150, 517, 600, 600);
    expect(setViewWindow).toHaveBeenLastCalledWith({ x: 150, y: 0, width: 400, height: 600 });
    expect(setKeepOnScreenPaused).toHaveBeenLastCalledWith(true);
  });

  it("resumes keep-on-screen and rethrows when the park's frame call is rejected", async () => {
    setFrameLogical.mockRejectedValueOnce(new Error("denied"));
    const frame = make();

    await expect(frame.park(EXTENTS)).rejects.toThrow("denied");

    expect(setKeepOnScreenPaused).toHaveBeenLastCalledWith(false);
    expect(setViewWindow).not.toHaveBeenCalled();
  });
});
