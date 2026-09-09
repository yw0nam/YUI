/**
 * travel-frame.test.ts — parking the real window once for a seam crossing and handing
 * the movers a virtual window that reports the reference-size framing inside it.
 *
 * Reference layout: built-in 1728×1117 logical at (0,0) scale 2; a 1920×1080 scale-1
 * display above it at (−992,−1080).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Renderer } from "../renderer";
import type { ScreenMonitor } from "./screen-geometry";
import { createTravelFrame, type FrameWindow } from "./travel-frame";

const BUILTIN: ScreenMonitor = {
  position: { x: 0, y: 0 },
  size: { width: 3456, height: 2234 },
  workArea: { position: { x: 0, y: 0 }, size: { width: 3456, height: 2234 } },
  scaleFactor: 2,
};

const LEFT_UPPER: ScreenMonitor = {
  position: { x: -992, y: -1080 },
  size: { width: 1920, height: 1080 },
  workArea: { position: { x: -992, y: -1080 }, size: { width: 1920, height: 1080 } },
  scaleFactor: 1,
};

const MONITORS = [BUILTIN, LEFT_UPPER];

/** Window origin logical (300, 517), size 400×600, on the built-in at scale 2. */
const START = { x: 300, y: 517 };
const SIZE = { width: 400, height: 600 };
/** Window origin logical (-700, -600), on the left-upper display's floor. */
const END = { x: -700, y: -600 };

describe("createTravelFrame", () => {
  let frame: FrameWindow;
  let setFrameLogical: FrameWindow["setFrameLogical"];
  let renderer: Pick<Renderer, "setViewWindow">;
  let setViewWindow: Renderer["setViewWindow"];
  let setKeepOnScreenPaused: (paused: boolean) => void;

  beforeEach(() => {
    setFrameLogical = vi.fn<FrameWindow["setFrameLogical"]>(async () => {});
    setViewWindow = vi.fn<Renderer["setViewWindow"]>(() => {});
    setKeepOnScreenPaused = vi.fn<(paused: boolean) => void>(() => {});
    frame = {
      outerPosition: vi.fn(async () => ({
        x: START.x * BUILTIN.scaleFactor,
        y: START.y * BUILTIN.scaleFactor,
      })),
      outerSize: vi.fn(async () => ({
        width: SIZE.width * BUILTIN.scaleFactor,
        height: SIZE.height * BUILTIN.scaleFactor,
      })),
      scaleFactor: vi.fn(async () => BUILTIN.scaleFactor),
      setPositionLogical: vi.fn(async (_x: number, _y: number) => {}),
      setFrameLogical,
    };
    renderer = { setViewWindow };
  });

  function makeTravel() {
    return createTravelFrame({
      frame,
      renderer,
      listMonitors: async () => MONITORS,
      setKeepOnScreenPaused,
    });
  }

  it("parks the frame as the bounding box of start and end with one call, and pauses the guard", async () => {
    const travel = makeTravel();
    await travel.begin(END);

    // Bounding box of [300,700]×[517,1117] and [-700,-300]×[-600,0].
    expect(setFrameLogical).toHaveBeenCalledTimes(1);
    expect(setFrameLogical).toHaveBeenCalledWith(-700, -600, 1400, 1717);
    expect(setKeepOnScreenPaused).toHaveBeenCalledWith(true);
  });

  it("reports the start monitor's scale and physical coordinates, then the end monitor's after a move", async () => {
    const travel = makeTravel();
    const t = await travel.begin(END);

    await expect(t.win.scaleFactor()).resolves.toBe(2);
    await expect(t.win.outerPosition()).resolves.toEqual({ x: 600, y: 1034 });
    await expect(t.win.outerSize()).resolves.toEqual({ width: 800, height: 1200 });

    await t.win.setPositionLogical(END.x, END.y);

    await expect(t.win.scaleFactor()).resolves.toBe(1);
    await expect(t.win.outerPosition()).resolves.toEqual({ x: -700, y: -600 });
    await expect(t.win.outerSize()).resolves.toEqual({ width: 400, height: 600 });
  });

  it("draws one view window per setPositionLogical, offset from the frame", async () => {
    const travel = makeTravel();
    const t = await travel.begin(END);
    vi.mocked(setViewWindow).mockClear();

    await t.win.setPositionLogical(END.x, END.y);

    expect(setViewWindow).toHaveBeenCalledTimes(1);
    expect(setViewWindow).toHaveBeenCalledWith({ x: 0, y: 0, width: 400, height: 600 });
  });

  it("ends with one more frame call at the final origin, clears the view, and resumes the guard", async () => {
    const travel = makeTravel();
    const t = await travel.begin(END);
    await t.win.setPositionLogical(END.x, END.y);
    vi.mocked(setFrameLogical).mockClear();
    vi.mocked(setViewWindow).mockClear();

    await t.end();

    expect(setFrameLogical).toHaveBeenCalledTimes(1);
    expect(setFrameLogical).toHaveBeenCalledWith(-700, -600, 400, 600);
    expect(setViewWindow).toHaveBeenCalledWith(null);
    expect(setKeepOnScreenPaused).toHaveBeenCalledWith(false);
    expect(travel.current()).toBeNull();

    vi.mocked(setFrameLogical).mockClear();
    await t.end();
    expect(setFrameLogical).not.toHaveBeenCalled();
  });

  it("exposes the virtual window through current() while a travel runs", async () => {
    const travel = makeTravel();
    expect(travel.current()).toBeNull();
    const t = await travel.begin(END);
    expect(travel.current()).toBe(t.win);
    await t.end();
    expect(travel.current()).toBeNull();
  });
});
