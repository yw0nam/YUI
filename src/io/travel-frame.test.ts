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

  it("applies the view offset only after the frame call resolves", async () => {
    let resolveFrame!: () => void;
    setFrameLogical = vi.fn<FrameWindow["setFrameLogical"]>(
      () =>
        new Promise<void>((resolve) => {
          resolveFrame = resolve;
        }),
    );
    frame.setFrameLogical = setFrameLogical;
    const travel = makeTravel();

    const begun = travel.begin(END);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(setViewWindow).not.toHaveBeenCalled();

    resolveFrame();
    await begun;

    // Offset of the start rect inside the frame [-700,-600]×1400×1717.
    expect(setViewWindow).toHaveBeenCalledWith({ x: 1000, y: 1117, width: 400, height: 600 });
  });

  it("ends the first travel when a second begin starts before it finishes", async () => {
    const travel = makeTravel();
    const first = await travel.begin(END);
    vi.mocked(setFrameLogical).mockClear();

    const second = await travel.begin({ x: 100, y: 517 });

    expect(setFrameLogical).toHaveBeenCalledTimes(2);
    // The first travel's own end call, parking at its own (unmoved) origin.
    expect(setFrameLogical).toHaveBeenNthCalledWith(1, START.x, START.y, SIZE.width, SIZE.height);
    expect(travel.current()).toBe(second.win);
    expect(travel.current()).not.toBe(first.win);
  });

  it("keeps current() non-null until the end frame call resolves", async () => {
    const travel = makeTravel();
    const t = await travel.begin(END);
    let resolveEnd!: () => void;
    vi.mocked(setFrameLogical).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveEnd = resolve;
        }),
    );

    const ending = t.end();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(travel.current()).toBe(t.win);

    resolveEnd();
    await ending;
    expect(travel.current()).toBeNull();
  });

  it("returns the same promise and makes one frame call when end() is called twice while pending", async () => {
    const travel = makeTravel();
    const t = await travel.begin(END);
    vi.mocked(setFrameLogical).mockClear();
    let resolveEnd!: () => void;
    vi.mocked(setFrameLogical).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveEnd = resolve;
        }),
    );

    const first = t.end();
    const second = t.end();
    expect(second).toBe(first);
    expect(setFrameLogical).toHaveBeenCalledTimes(1);

    resolveEnd();
    await first;
  });

  it("resumes the guard and rethrows when begin's own frame call rejects", async () => {
    setFrameLogical = vi.fn<FrameWindow["setFrameLogical"]>(async () => {
      throw new Error("boom");
    });
    frame.setFrameLogical = setFrameLogical;
    const travel = makeTravel();

    await expect(travel.begin(END)).rejects.toThrow("boom");

    expect(setKeepOnScreenPaused).toHaveBeenLastCalledWith(false);
    expect(travel.current()).toBeNull();
  });

  it("clears the view and resumes the guard when end's own frame call rejects", async () => {
    const travel = makeTravel();
    const t = await travel.begin(END);
    vi.mocked(setViewWindow).mockClear();
    vi.mocked(setFrameLogical).mockImplementation(async () => {
      throw new Error("boom");
    });

    await expect(t.end()).rejects.toThrow("boom");

    expect(setViewWindow).toHaveBeenCalledWith(null);
    expect(setKeepOnScreenPaused).toHaveBeenCalledWith(false);
    expect(travel.current()).toBeNull();
  });

  it("forwards every call to the real window once the virtual window has ended", async () => {
    const travel = makeTravel();
    const t = await travel.begin(END);
    await t.win.setPositionLogical(END.x, END.y);
    await t.end();
    vi.mocked(frame.setPositionLogical).mockClear();

    await t.win.setPositionLogical(123, 456);
    const pos = await t.win.outerPosition();
    const size = await t.win.outerSize();
    const scale = await t.win.scaleFactor();

    expect(frame.setPositionLogical).toHaveBeenCalledWith(123, 456);
    expect(pos).toEqual({ x: START.x * BUILTIN.scaleFactor, y: START.y * BUILTIN.scaleFactor });
    expect(size).toEqual({
      width: SIZE.width * BUILTIN.scaleFactor,
      height: SIZE.height * BUILTIN.scaleFactor,
    });
    expect(scale).toBe(BUILTIN.scaleFactor);
  });

  it("settled() resolves once the pending end finishes", async () => {
    const travel = makeTravel();
    const t = await travel.begin(END);
    let resolveEnd!: () => void;
    vi.mocked(setFrameLogical).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveEnd = resolve;
        }),
    );

    void t.end();
    let settledResolved = false;
    void travel.settled().then(() => {
      settledResolved = true;
    });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(settledResolved).toBe(false);

    resolveEnd();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(settledResolved).toBe(true);
  });

  it("settled() resolves immediately when nothing is ending", async () => {
    const travel = makeTravel();
    await expect(travel.settled()).resolves.toBeUndefined();
    const t = await travel.begin(END);
    await expect(travel.settled()).resolves.toBeUndefined();
    await t.end();
    await expect(travel.settled()).resolves.toBeUndefined();
  });

  it("settled() waits for a pending begin before resolving", async () => {
    let resolveFrame!: () => void;
    setFrameLogical = vi.fn<FrameWindow["setFrameLogical"]>(
      () =>
        new Promise<void>((resolve) => {
          resolveFrame = resolve;
        }),
    );
    frame.setFrameLogical = setFrameLogical;
    const travel = makeTravel();

    const begun = travel.begin(END);
    let settledResolved = false;
    void travel.settled().then(() => {
      settledResolved = true;
    });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(settledResolved).toBe(false);

    resolveFrame();
    await begun;
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(settledResolved).toBe(true);
  });

  it("settled() waits for an end() the caller chains immediately onto a resolved begin", async () => {
    // Mirrors the climber's cancel-during-begin path: `travel = await deps.travel.begin(...);
    // if (!alive) { void t.end(); }` — no await between begin() resolving and end() starting.
    const travel = makeTravel();
    let resolveEnd!: () => void;
    let callCount = 0;
    setFrameLogical = vi.fn<FrameWindow["setFrameLogical"]>(async () => {
      callCount++;
      if (callCount === 2) {
        return new Promise<void>((resolve) => {
          resolveEnd = resolve;
        });
      }
    });
    frame.setFrameLogical = setFrameLogical;

    const begun = travel.begin(END);
    let settledResolved = false;
    void travel.settled().then(() => {
      settledResolved = true;
    });

    const t = await begun;
    void t.end();

    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(settledResolved).toBe(false);

    resolveEnd();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(settledResolved).toBe(true);
  });

  it("includes a via origin in the frame's bounding box", async () => {
    const travel = makeTravel();
    const via = { x: -1200, y: 517 };

    await travel.begin(END, [via]);

    // Bounding box of start [300,700]×[517,1117], end [-700,-300]×[-600,0], and
    // via [-1200,-800]×[517,1117].
    expect(setFrameLogical).toHaveBeenCalledWith(-1200, -600, 1900, 1717);
  });
});
