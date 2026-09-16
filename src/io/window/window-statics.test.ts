/**
 * window-statics.test.ts — the cached window geometry both cursor poll loops read.
 *
 * Covers the cache itself: what a refreshing read stores, what a cached read skips, and
 * the move/resize/scale-change subscription that invalidates it. How each caller drives
 * it (refresh cadence, skipped samples, reschedule) stays pinned in cursor-tracker.test.ts
 * and hit-test.test.ts.
 */

import { describe, expect, it, vi } from "vitest";
import { createWindowStatics } from "./window-statics";

function fakeSource() {
  let movedCb: (() => void) | undefined;
  let resizedCb: (() => void) | undefined;
  let scaleCb: (() => void) | undefined;
  const unlistenMoved = vi.fn();
  const unlistenResized = vi.fn();
  const unlistenScaleChanged = vi.fn();
  return {
    cursorPosition: vi.fn(async () => ({ x: 300, y: 400 })),
    outerPosition: vi.fn(async () => ({ x: 100, y: 200 })),
    scaleFactor: vi.fn(async () => 2),
    primaryScaleFactor: vi.fn(async () => 3),
    onMoved: vi.fn(async (cb: () => void) => {
      movedCb = cb;
      return unlistenMoved;
    }),
    onResized: vi.fn(async (cb: () => void) => {
      resizedCb = cb;
      return unlistenResized;
    }),
    onScaleChanged: vi.fn(async (cb: () => void) => {
      scaleCb = cb;
      return unlistenScaleChanged;
    }),
    unlistenMoved,
    unlistenResized,
    unlistenScaleChanged,
    fireMoved: () => movedCb?.(),
    fireResized: () => resizedCb?.(),
    fireScaleChanged: () => scaleCb?.(),
  };
}

describe("createWindowStatics — cached reads", () => {
  it("a refreshing read returns the cursor and caches the origin and both scale factors", async () => {
    const win = fakeSource();
    const statics = createWindowStatics();
    const cursor = await statics.readCursor(win, true);
    expect(cursor).toEqual({ x: 300, y: 400 });
    expect(statics.origin).toEqual({ x: 100, y: 200 });
    expect(statics.scale).toBe(2);
    expect(statics.cursorScale).toBe(3);
  });

  it("a cached read only reads the cursor, leaving the statics untouched", async () => {
    const win = fakeSource();
    const statics = createWindowStatics();
    await statics.readCursor(win, true);
    win.outerPosition.mockClear();
    win.scaleFactor.mockClear();
    win.primaryScaleFactor.mockClear();

    const cursor = await statics.readCursor(win, false);
    expect(cursor).toEqual({ x: 300, y: 400 });
    expect(win.cursorPosition).toHaveBeenCalledTimes(2);
    expect(win.outerPosition).not.toHaveBeenCalled();
    expect(win.scaleFactor).not.toHaveBeenCalled();
    expect(win.primaryScaleFactor).not.toHaveBeenCalled();
    expect(statics.origin).toEqual({ x: 100, y: 200 });
  });

  it("falls back to the window scale factor when the source has no primaryScaleFactor", async () => {
    const win = fakeSource();
    const statics = createWindowStatics();
    await statics.readCursor({ ...win, primaryScaleFactor: undefined }, true);
    expect(statics.scale).toBe(2);
    expect(statics.cursorScale).toBe(2);
  });

  it("invalidate drops the cached origin", async () => {
    const win = fakeSource();
    const statics = createWindowStatics();
    await statics.readCursor(win, true);
    statics.invalidate();
    expect(statics.origin).toBeNull();
  });
});

describe("createWindowStatics — window event subscription", () => {
  it("invalidates the cache on a move, a resize and a scale change alike", async () => {
    const win = fakeSource();
    const statics = createWindowStatics();
    statics.subscribe(win);

    for (const fire of [win.fireMoved, win.fireResized, win.fireScaleChanged]) {
      await statics.readCursor(win, true);
      expect(statics.origin).not.toBeNull();
      fire();
      expect(statics.origin).toBeNull();
    }
  });

  it("unsubscribe calls every unlisten handle once", async () => {
    const win = fakeSource();
    const statics = createWindowStatics();
    statics.subscribe(win);
    await Promise.resolve(); // let the onMoved/onResized/onScaleChanged promises settle
    statics.unsubscribe();
    await Promise.resolve();
    expect(win.unlistenMoved).toHaveBeenCalledTimes(1);
    expect(win.unlistenResized).toHaveBeenCalledTimes(1);
    expect(win.unlistenScaleChanged).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe before the listen promise resolves still unsubscribes once it does", async () => {
    const win = fakeSource();
    const unlistenMoved = vi.fn();
    let resolveOnMoved: (() => void) | undefined;
    win.onMoved.mockImplementation(
      () =>
        new Promise<typeof unlistenMoved>((resolve) => {
          resolveOnMoved = () => resolve(unlistenMoved);
        }),
    );
    const statics = createWindowStatics();
    statics.subscribe(win);
    statics.unsubscribe(); // lands before onMoved's promise has resolved
    resolveOnMoved?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(unlistenMoved).toHaveBeenCalledTimes(1);
  });

  it("a source without the window events subscribes to nothing and stays cacheable", async () => {
    const win = fakeSource();
    const statics = createWindowStatics();
    statics.subscribe({
      cursorPosition: win.cursorPosition,
      outerPosition: win.outerPosition,
      scaleFactor: win.scaleFactor,
    });
    statics.unsubscribe();
    await statics.readCursor(win, true);
    expect(statics.origin).toEqual({ x: 100, y: 200 });
  });
});
