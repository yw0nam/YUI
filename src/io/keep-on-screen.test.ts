/**
 * keep-on-screen.test.ts — the off-screen recovery math and its debounced onMoved/onResized wiring.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachKeepOnScreen, type KeepOnScreenWindow, keepOnScreen } from "./keep-on-screen";
import type { ScreenMonitor } from "./screen-geometry";

/** Mirrors the module's own debounce ceiling. */
const IDLE_MS = 300;

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
    expect(keepOnScreen([LEFT], { x: 800, y: 400 }, { width: 200, height: 100 })).toBeNull();
  });

  it("pushes a window dragged past the right edge so half the overhang remains", () => {
    const result = keepOnScreen([LEFT], { x: 1800, y: 400 }, { width: 400, height: 300 });
    expect(result).toEqual({ x: 1718, y: 400 });
  });

  it("pushes a window dragged past the top edge", () => {
    const result = keepOnScreen([LEFT], { x: 800, y: -150 }, { width: 300, height: 200 });
    expect(result).toEqual({ x: 800, y: -100 });
  });

  it("pushes a window dragged past the left edge", () => {
    const result = keepOnScreen([LEFT], { x: -250, y: 400 }, { width: 300, height: 200 });
    expect(result).toEqual({ x: -150, y: 400 });
  });

  it("pushes a window dragged past the bottom edge", () => {
    const result = keepOnScreen([LEFT], { x: 800, y: 1000 }, { width: 300, height: 200 });
    expect(result).toEqual({ x: 800, y: 978 });
  });

  it("returns integer coordinates for an odd-sized window pushed off the edge", () => {
    const result = keepOnScreen([LEFT], { x: 1800, y: 400 }, { width: 401, height: 301 });
    expect(result).toEqual({ x: 1718, y: 400 });
    expect(Number.isInteger(result?.x)).toBe(true);
    expect(Number.isInteger(result?.y)).toBe(true);
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
    expect(result).toEqual({ x: 1818, y: 0 });
  });

  it("passes when there are no monitors to push against", () => {
    expect(keepOnScreen([], { x: 800, y: 400 }, { width: 200, height: 100 })).toBeNull();
  });

  it("passes an overhang under half the width when the check is center-only (no inset)", () => {
    // Right edge at 2000 overhangs the 1920 boundary by 80px, under half the 300px width —
    // the center (1850) still sits on screen.
    const result = keepOnScreen([LEFT], { x: 1700, y: 400 }, { width: 300, height: 200 });
    expect(result).toBeNull();
  });

  it("pushes the whole window on screen when inset is half its size", () => {
    const size = { width: 300, height: 200 };
    const result = keepOnScreen([LEFT], { x: 1700, y: 400 }, size, {
      x: size.width / 2,
      y: size.height / 2,
    });
    // Right edge lands EDGE_INSET_PX inside the monitor's right edge: 1920 - 300 - 2 = 1618.
    expect(result).toEqual({ x: 1618, y: 400 });
  });
});

describe("attachKeepOnScreen", () => {
  let win: KeepOnScreenWindow;
  let pos: { x: number; y: number };
  let onMovedCb: () => void;
  let onResizedCb: () => void;
  let listMonitors: () => Promise<ScreenMonitor[]>;

  beforeEach(() => {
    vi.useFakeTimers();
    pos = { x: 1800, y: 400 };
    onMovedCb = () => {};
    onResizedCb = () => {};
    listMonitors = vi.fn(async () => [LEFT]);
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
      onResized: vi.fn(async (cb: () => void) => {
        onResizedCb = cb;
        return () => {};
      }),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs one startup pass right after wiring, since opening emits no move event", async () => {
    await attachKeepOnScreen(win, listMonitors);
    await vi.runOnlyPendingTimersAsync();

    expect(win.setPositionPhysical).toHaveBeenCalledTimes(1);
    expect(win.setPositionPhysical).toHaveBeenCalledWith(1718, 400);
  });

  it("does not re-trigger once the pushed position already sits on screen", async () => {
    await attachKeepOnScreen(win, listMonitors);
    await vi.runOnlyPendingTimersAsync(); // startup pass pushes to {x:1718, y:400}
    vi.mocked(win.setPositionPhysical).mockClear();

    onMovedCb(); // the guard's own setPosition re-fires onMoved
    await vi.advanceTimersByTimeAsync(IDLE_MS);

    expect(win.setPositionPhysical).not.toHaveBeenCalled();
  });

  it("evaluates on a resize too, since resizing emits no move event", async () => {
    await attachKeepOnScreen(win, listMonitors);
    await vi.runOnlyPendingTimersAsync(); // startup pass pushes to {x:1718, y:400}
    vi.mocked(win.setPositionPhysical).mockClear();

    pos = { x: 1800, y: 400 }; // back off-screen, as if the content grew past the edge
    onResizedCb();
    await vi.advanceTimersByTimeAsync(IDLE_MS);

    expect(win.setPositionPhysical).toHaveBeenCalledWith(1718, 400);
  });

  it("collapses a storm of onMoved events into a single evaluation after the idle window", async () => {
    await attachKeepOnScreen(win, listMonitors);
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

  it("pushes the whole window on screen when wholeWindow reads the current outerSize", async () => {
    win.outerSize = vi.fn(async () => ({ width: 300, height: 200 }));
    pos = { x: 1700, y: 400 }; // overhangs the right edge, but the center is still on screen

    await attachKeepOnScreen(win, listMonitors, { wholeWindow: true });
    await vi.runOnlyPendingTimersAsync();

    expect(win.setPositionPhysical).toHaveBeenCalledWith(1618, 400);
  });

  it("stops evaluating after the returned unlisten runs", async () => {
    const unlisten = await attachKeepOnScreen(win, listMonitors);
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
