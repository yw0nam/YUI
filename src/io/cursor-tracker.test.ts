/**
 * Tests for src/io/cursor-tracker.ts — global OS-cursor tracker feeding cursor-gaze.
 *
 * Environment: node (vitest default) — fake window/scheduler/doc seams, no Tauri runtime
 * for the poll path (mirrors src/io/hit-test.test.ts's style).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(),
  cursorPosition: vi.fn(),
  primaryMonitor: vi.fn(),
}));

import { createCursorTracker } from "./cursor-tracker";

type Cursor = { x: number; y: number } | null;

interface FakeWin {
  cursorPosition: ReturnType<typeof vi.fn>;
  outerPosition: ReturnType<typeof vi.fn>;
  scaleFactor: ReturnType<typeof vi.fn>;
  primaryScaleFactor: ReturnType<typeof vi.fn>;
  onMoved: ReturnType<typeof vi.fn>;
  onResized: ReturnType<typeof vi.fn>;
  onScaleChanged: ReturnType<typeof vi.fn>;
  unlistenMoved: ReturnType<typeof vi.fn>;
  unlistenResized: ReturnType<typeof vi.fn>;
  unlistenScaleChanged: ReturnType<typeof vi.fn>;
  fireMoved(): void;
  fireResized(): void;
  fireScaleChanged(): void;
}

function fakeWindow(cursorPhys = { x: 0, y: 0 }): FakeWin {
  let movedCb: (() => void) | undefined;
  let resizedCb: (() => void) | undefined;
  let scaleCb: (() => void) | undefined;
  const unlistenMoved = vi.fn();
  const unlistenResized = vi.fn();
  const unlistenScaleChanged = vi.fn();
  return {
    cursorPosition: vi.fn(async () => ({ ...cursorPhys })),
    outerPosition: vi.fn(async () => ({ x: 0, y: 0 })),
    scaleFactor: vi.fn(async () => 1),
    primaryScaleFactor: vi.fn(async () => 1),
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
    fireMoved() {
      movedCb?.();
    },
    fireResized() {
      resizedCb?.();
    },
    fireScaleChanged() {
      scaleCb?.();
    },
  };
}

interface FakeDoc {
  visibilityState: "visible" | "hidden";
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  fire(): void;
}

function fakeDoc(): FakeDoc {
  let cb: (() => void) | undefined;
  return {
    visibilityState: "visible",
    addEventListener: vi.fn((_type: string, listener: () => void) => {
      cb = listener;
    }),
    removeEventListener: vi.fn(),
    fire() {
      cb?.();
    },
  };
}

/** Drives the poll loop deterministically: `schedule` captures the latest callback + ms. */
function scheduledPoller(win: FakeWin, doc: FakeDoc) {
  const positions: Cursor[] = [];
  const scheduled: number[] = [];
  const cancel = vi.fn();
  let cb: (() => void) | undefined;
  const getWindow = vi.fn(() => win as never);
  const c = createCursorTracker({
    onCursor: (p) => positions.push(p),
    getWindow,
    doc: doc as never,
    schedule: (callback, ms) => {
      cb = callback;
      scheduled.push(ms);
      return scheduled.length;
    },
    cancel,
  });
  return {
    c,
    positions,
    scheduled,
    cancel,
    getWindow,
    poll: async (): Promise<void> => {
      const fn = cb;
      cb = undefined;
      await fn?.();
    },
  };
}

describe("createCursorTracker — Tauri poll path", () => {
  beforeEach(() => {
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  });
  afterEach(() => {
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("happy path: converts the polled cursor with DPI and reports window-local CSS px", async () => {
    const win = fakeWindow({ x: 300, y: 400 });
    win.outerPosition.mockResolvedValue({ x: 100, y: 200 });
    win.scaleFactor.mockResolvedValue(2);
    win.primaryScaleFactor.mockResolvedValue(2);
    const doc = fakeDoc();
    const { c, positions, poll } = scheduledPoller(win, doc);
    c.start();
    await poll();
    expect(positions).toEqual([{ x: 100, y: 100 }]);
    c.stop();
  });

  it("3 consecutive failures report null once and back off to 1000ms", async () => {
    const win = fakeWindow();
    win.cursorPosition.mockRejectedValue(new Error("failed to get cursor position"));
    const doc = fakeDoc();
    const { c, positions, scheduled, poll } = scheduledPoller(win, doc);
    c.start();
    await poll();
    await poll();
    await poll();
    expect(positions).toEqual([null]);
    expect(scheduled.at(-1)).toBe(1000);
    c.stop();
  });

  it("a success after failures resets the counter and restores the 33ms cadence", async () => {
    const win = fakeWindow({ x: 0, y: 0 });
    win.cursorPosition
      .mockRejectedValueOnce(new Error("1"))
      .mockRejectedValueOnce(new Error("2"))
      .mockRejectedValueOnce(new Error("3"))
      .mockResolvedValue({ x: 0, y: 0 });
    const doc = fakeDoc();
    const { c, positions, scheduled, poll } = scheduledPoller(win, doc);
    c.start();
    await poll();
    await poll();
    await poll();
    expect(scheduled.at(-1)).toBe(1000);
    await poll();
    expect(positions.at(-1)).toEqual({ x: 0, y: 0 });
    expect(scheduled.at(-1)).toBe(33);
    c.stop();
  });

  it("a hidden document pauses polling and reports null; visible resumes it", async () => {
    const win = fakeWindow();
    const doc = fakeDoc();
    const { c, positions, scheduled, poll } = scheduledPoller(win, doc);
    c.start();
    await poll(); // one successful poll while visible
    positions.length = 0;

    doc.visibilityState = "hidden";
    doc.fire();
    expect(positions).toEqual([null]);
    const countWhenHidden = scheduled.length;

    doc.visibilityState = "visible";
    doc.fire();
    expect(scheduled.length).toBe(countWhenHidden + 1);
    expect(scheduled.at(-1)).toBe(33);
    c.stop();
  });

  it("only re-reads outerPosition/scaleFactor/primaryScaleFactor every 8th tick", async () => {
    const win = fakeWindow({ x: 300, y: 400 });
    win.outerPosition.mockResolvedValue({ x: 100, y: 200 });
    win.scaleFactor.mockResolvedValue(2);
    win.primaryScaleFactor.mockResolvedValue(2);
    const doc = fakeDoc();
    const { c, poll } = scheduledPoller(win, doc);
    c.start();
    for (let i = 0; i < 8; i++) await poll();
    // Tick 0 (start) + tick 8 (this loop's 9th poll would trigger it, so within 8 polls
    // only the first tick refreshes the statics).
    expect(win.cursorPosition).toHaveBeenCalledTimes(8);
    expect(win.outerPosition).toHaveBeenCalledTimes(1);
    expect(win.scaleFactor).toHaveBeenCalledTimes(1);
    expect(win.primaryScaleFactor).toHaveBeenCalledTimes(1);
    await poll(); // 9th tick (index 8) ⇒ refresh again
    expect(win.outerPosition).toHaveBeenCalledTimes(2);
    c.stop();
  });

  it("a window move invalidates the cached statics before the next tick", async () => {
    const win = fakeWindow({ x: 300, y: 400 });
    win.outerPosition.mockResolvedValue({ x: 100, y: 200 });
    win.scaleFactor.mockResolvedValue(2);
    win.primaryScaleFactor.mockResolvedValue(2);
    const doc = fakeDoc();
    const { c, poll } = scheduledPoller(win, doc);
    c.start();
    await poll(); // tick 0 — refreshes (start-of-life)
    await poll(); // tick 1 — cached, no refresh
    expect(win.outerPosition).toHaveBeenCalledTimes(1);

    win.fireMoved(); // window drag moved the window — invalidate now, well before tick 8
    await poll(); // tick 2 — refreshes despite tick % 8 !== 0
    expect(win.outerPosition).toHaveBeenCalledTimes(2);
    c.stop();
  });

  // Regression: invalidateStatics() firing WHILE a cached tick's cursorPosition() is in
  // flight must not kill the self-scheduling loop — a guard that returns before the
  // reschedule tail freezes gaze permanently. Mirrors src/io/hit-test.test.ts's identical
  // regression for the hit-test poll.
  it("a move landing mid-await on a cached tick skips the sample but still reschedules", async () => {
    const win = fakeWindow({ x: 300, y: 400 });
    win.outerPosition.mockResolvedValue({ x: 100, y: 200 });
    win.scaleFactor.mockResolvedValue(2);
    win.primaryScaleFactor.mockResolvedValue(2);
    const doc = fakeDoc();
    const { c, positions, scheduled, poll } = scheduledPoller(win, doc);
    c.start();
    expect(scheduled.length).toBe(1);

    await poll(); // tick 0 — refreshes, establishes cachedOrigin
    expect(scheduled.length).toBe(2);
    positions.length = 0;

    // tick 1 is a cached tick. Simulate the window moving while cursorPosition() is in
    // flight: the mock invalidates the cache as a side effect before its promise resolves.
    win.cursorPosition.mockImplementationOnce(async () => {
      win.fireMoved();
      return { x: 300, y: 400 };
    });
    await poll(); // tick 1 — cachedOrigin goes null mid-await

    // The loop must still reschedule despite landing with a stale cache.
    expect(scheduled.length).toBe(3);
    // The invalidated tick skips sampling rather than applying a stale/missing origin.
    expect(positions).toEqual([]);

    // The next tick recovers: refreshes statics (cachedOrigin was cleared) and samples normally.
    win.outerPosition.mockClear();
    await poll(); // tick 2
    expect(win.outerPosition).toHaveBeenCalledTimes(1);
    expect(positions).toEqual([{ x: 100, y: 100 }]);
    c.stop();
  });

  it("stop() unsubscribes the move/resize/scale-change listeners", async () => {
    const win = fakeWindow();
    const doc = fakeDoc();
    const { c } = scheduledPoller(win, doc);
    c.start();
    await Promise.resolve(); // let the onMoved/onResized/onScaleChanged promises settle
    c.stop();
    await Promise.resolve();
    expect(win.unlistenMoved).toHaveBeenCalledTimes(1);
    expect(win.unlistenResized).toHaveBeenCalledTimes(1);
    expect(win.unlistenScaleChanged).toHaveBeenCalledTimes(1);
  });

  it("stop() before the listen promise resolves still unsubscribes once it does", async () => {
    const win = fakeWindow();
    const unlistenMoved = vi.fn();
    let resolveOnMoved: (() => void) | undefined;
    win.onMoved.mockImplementation(
      () =>
        new Promise<typeof unlistenMoved>((resolve) => {
          resolveOnMoved = () => resolve(unlistenMoved);
        }),
    );
    const doc = fakeDoc();
    const { c } = scheduledPoller(win, doc);
    c.start();
    c.stop(); // stop() lands before onMoved's promise has resolved
    resolveOnMoved?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(unlistenMoved).toHaveBeenCalledTimes(1);
  });

  it("a mixed-DPI reading (cursorSf !== sf) converts with the primary scale, not the window's", async () => {
    const win = fakeWindow({ x: 329.84375, y: -937.0390625 });
    win.outerPosition.mockResolvedValue({ x: -28, y: -726 });
    win.scaleFactor.mockResolvedValue(1);
    win.primaryScaleFactor.mockResolvedValue(2);
    const doc = fakeDoc();
    const { c, positions, poll } = scheduledPoller(win, doc);
    c.start();
    await poll();
    expect(positions).toHaveLength(1);
    expect(positions[0]?.x).toBeCloseTo(192.92, 1);
    expect(positions[0]?.y).toBeCloseTo(257.48, 1);
    c.stop();
  });

  it("stop() cancels the pending timer via the real cancel seam", async () => {
    const win = fakeWindow();
    const doc = fakeDoc();
    const { c, scheduled, cancel } = scheduledPoller(win, doc);
    c.start();
    expect(scheduled).toEqual([33]);
    c.stop();
    expect(cancel).toHaveBeenCalledWith(1); // schedule's first handle, per scheduledPoller
  });

  it("double-start() is a no-op", () => {
    const win = fakeWindow();
    const doc = fakeDoc();
    const { c, scheduled, getWindow } = scheduledPoller(win, doc);
    c.start();
    c.start();
    expect(getWindow).toHaveBeenCalledTimes(1);
    expect(scheduled).toEqual([33]);
    c.stop();
  });

  it("start() while the document is already hidden does not poll", () => {
    const win = fakeWindow();
    const doc = fakeDoc();
    doc.visibilityState = "hidden";
    const { c, scheduled } = scheduledPoller(win, doc);
    c.start();
    expect(scheduled).toEqual([]);
    c.stop();
  });

  it("stop() during an in-flight poll suppresses the emit", async () => {
    const win = fakeWindow({ x: 300, y: 400 });
    win.outerPosition.mockResolvedValue({ x: 100, y: 200 });
    win.scaleFactor.mockResolvedValue(2);
    win.primaryScaleFactor.mockResolvedValue(2);
    let resolveCursor: ((v: { x: number; y: number }) => void) | undefined;
    win.cursorPosition.mockImplementation(
      () =>
        new Promise<{ x: number; y: number }>((resolve) => {
          resolveCursor = resolve;
        }),
    );
    const doc = fakeDoc();
    const { c, positions, poll } = scheduledPoller(win, doc);
    c.start();
    void poll(); // fires the scheduled poll; cursorPosition() is now pending
    c.stop(); // teardown while the read is still in flight
    resolveCursor?.({ x: 300, y: 400 });
    await new Promise((r) => setTimeout(r, 0)); // flush the poll's continuation
    expect(positions).toEqual([]);
  });
});

describe("createCursorTracker — non-Tauri mousemove path", () => {
  const orig = (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  beforeEach(() => {
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });
  afterEach(() => {
    if (orig === undefined)
      delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    else (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = orig;
  });

  it("forwards mousemove clientX/clientY as the window-local cursor position", () => {
    const target = new EventTarget();
    const positions: Cursor[] = [];
    const c = createCursorTracker({ onCursor: (p) => positions.push(p), moveTarget: target });
    c.start();
    target.dispatchEvent(
      Object.assign(new Event("mousemove"), { clientX: 12, clientY: 34 }) as Event,
    );
    expect(positions).toEqual([{ x: 12, y: 34 }]);
    c.stop();
  });

  it("mouseleave reports the cursor unavailable", () => {
    const target = new EventTarget();
    const positions: Cursor[] = [];
    const c = createCursorTracker({ onCursor: (p) => positions.push(p), moveTarget: target });
    c.start();
    target.dispatchEvent(
      Object.assign(new Event("mousemove"), { clientX: 12, clientY: 34 }) as Event,
    );
    target.dispatchEvent(new Event("mouseleave"));
    expect(positions).toEqual([{ x: 12, y: 34 }, null]);
    c.stop();
  });

  it("stops forwarding after stop()", () => {
    const target = new EventTarget();
    const positions: Cursor[] = [];
    const c = createCursorTracker({ onCursor: (p) => positions.push(p), moveTarget: target });
    c.start();
    c.stop();
    target.dispatchEvent(
      Object.assign(new Event("mousemove"), { clientX: 1, clientY: 1 }) as Event,
    );
    expect(positions).toEqual([]);
  });
});
