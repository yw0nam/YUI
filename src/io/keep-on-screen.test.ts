/**
 * keep-on-screen.test.ts — the off-screen recovery math and its debounced onMoved wiring.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../logger";
import { attachKeepOnScreen, type KeepOnScreenWindow, keepOnScreen } from "./keep-on-screen";
import type { ScreenMonitor } from "./screen-geometry";

const SINGLE: ScreenMonitor = {
  position: { x: 0, y: 0 },
  size: { width: 1920, height: 1080 },
  workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } },
};

const LEFT: ScreenMonitor = {
  position: { x: 0, y: 0 },
  size: { width: 1920, height: 1080 },
  workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } },
};

const RIGHT: ScreenMonitor = {
  position: { x: 1920, y: 0 },
  size: { width: 1280, height: 1024 },
  workArea: { position: { x: 1920, y: 0 }, size: { width: 1280, height: 1024 } },
};

/** Vertically offset from LEFT, with a 280px horizontal gap — creates a corner gap region. */
const GAPPED_RIGHT: ScreenMonitor = {
  position: { x: 2200, y: 500 },
  size: { width: 1280, height: 1024 },
  workArea: { position: { x: 2200, y: 500 }, size: { width: 1280, height: 1024 } },
};

describe("keepOnScreen", () => {
  it("passes when the center sits inside a monitor", () => {
    expect(keepOnScreen([SINGLE], { x: 800, y: 400 }, { width: 200, height: 100 })).toBeNull();
  });

  it("pushes a window dragged past the right edge so half the overhang remains", () => {
    const result = keepOnScreen([SINGLE], { x: 1800, y: 400 }, { width: 400, height: 300 });
    expect(result).toEqual({ x: 1720, y: 400 });
  });

  it("pushes a window dragged past the top edge", () => {
    const result = keepOnScreen([SINGLE], { x: 800, y: -150 }, { width: 300, height: 200 });
    expect(result).toEqual({ x: 800, y: -100 });
  });

  it("pushes a window dragged past the left edge", () => {
    const result = keepOnScreen([SINGLE], { x: -250, y: 400 }, { width: 300, height: 200 });
    expect(result).toEqual({ x: -150, y: 400 });
  });

  it("pushes a window dragged past the bottom edge", () => {
    const result = keepOnScreen([SINGLE], { x: 800, y: 1000 }, { width: 300, height: 200 });
    expect(result).toEqual({ x: 800, y: 980 });
  });

  it("passes a window straddling the seam of two monitors when the center sits in the second", () => {
    const result = keepOnScreen([LEFT, RIGHT], { x: 1750, y: 400 }, { width: 400, height: 300 });
    expect(result).toBeNull();
  });

  it("pushes to the nearest monitor when the center lands in a gap between misaligned monitors", () => {
    const result = keepOnScreen(
      [LEFT, GAPPED_RIGHT],
      { x: 1950, y: 0 },
      { width: 200, height: 200 },
    );
    expect(result).toEqual({ x: 1820, y: 0 });
  });

  it("passes when there are no monitors to push against", () => {
    expect(keepOnScreen([], { x: 800, y: 400 }, { width: 200, height: 100 })).toBeNull();
  });
});

describe("attachKeepOnScreen", () => {
  let win: KeepOnScreenWindow;
  let pos: { x: number; y: number };
  let onMovedCb: () => void;
  let listMonitors: () => Promise<ScreenMonitor[]>;
  let log: Logger & { info: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    pos = { x: 1800, y: 400 };
    onMovedCb = () => {};
    listMonitors = vi.fn(async () => [SINGLE]);
    log = { info: vi.fn(), warn: () => {}, error: () => {}, debug: () => {} } as never;
    win = {
      outerPosition: vi.fn(async () => pos),
      outerSize: vi.fn(async () => ({ width: 400, height: 300 })),
      setPositionPhysical: vi.fn(async (x: number, y: number) => {
        pos = { x, y };
      }),
      onMoved: vi.fn(async (cb: () => void) => {
        onMovedCb = cb;
        return () => {};
      }),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs one startup pass right after wiring, since opening emits no move event", async () => {
    await attachKeepOnScreen(win, listMonitors, log);
    await vi.runOnlyPendingTimersAsync();

    expect(win.setPositionPhysical).toHaveBeenCalledTimes(1);
    expect(win.setPositionPhysical).toHaveBeenCalledWith(1720, 400);
    expect(log.info).toHaveBeenCalledWith(
      "keep_on_screen_push",
      expect.objectContaining({ toX: 1720, toY: 400 }),
    );
  });

  it("collapses a storm of onMoved events into a single evaluation after the idle window", async () => {
    await attachKeepOnScreen(win, listMonitors, log);
    await vi.runOnlyPendingTimersAsync(); // drain the startup pass
    vi.mocked(win.setPositionPhysical).mockClear();
    vi.mocked(win.outerPosition).mockClear();

    pos = { x: 100, y: 100 }; // back on screen, so the storm itself should settle quiet
    onMovedCb();
    vi.advanceTimersByTime(100);
    onMovedCb();
    vi.advanceTimersByTime(100);
    onMovedCb();
    await vi.advanceTimersByTimeAsync(300);

    expect(win.outerPosition).toHaveBeenCalledTimes(1);
    expect(win.setPositionPhysical).not.toHaveBeenCalled();
  });

  it("stops evaluating after the returned unlisten runs", async () => {
    const unlisten = await attachKeepOnScreen(win, listMonitors, log);
    await vi.runOnlyPendingTimersAsync();
    vi.mocked(win.setPositionPhysical).mockClear();
    vi.mocked(win.outerPosition).mockClear();

    unlisten();
    onMovedCb();
    await vi.advanceTimersByTimeAsync(300);

    expect(win.outerPosition).not.toHaveBeenCalled();
    expect(win.setPositionPhysical).not.toHaveBeenCalled();
  });
});
