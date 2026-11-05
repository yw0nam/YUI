/**
 * Tests for src/io/window/pet/cursor-source.ts — the one OS-cursor poll shared by gaze and the
 * click-through hit-test.
 *
 * Environment: node (vitest default) — fake window/scheduler/doc seams drive the poll; the
 * Tauri window module is mocked for the default-window cases.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(),
  cursorPosition: vi.fn(),
  primaryMonitor: vi.fn(),
}));

import { cursorPosition, getCurrentWindow, primaryMonitor } from "@tauri-apps/api/window";
import { createCursorSource, physicalCursorToLocalCss } from "./cursor-source";

type Cursor = { x: number; y: number } | null;

// ─── physicalCursorToLocalCss ──────────────────────────────────────────────────

describe("physicalCursorToLocalCss", () => {
  it.each([
    [
      "DPI 1 — subtracts the window origin, identity scale",
      { x: 150, y: 220 },
      { x: 100, y: 200 },
      1,
      { x: 50, y: 20 },
    ],
    [
      "DPI 2 (Retina) — divides the physical delta by the scale factor",
      { x: 300, y: 400 },
      { x: 100, y: 200 },
      2,
      { x: 100, y: 100 },
    ],
    [
      "DPI 1.5 (Windows HiDPI) — fractional scale",
      { x: 250, y: 350 },
      { x: 100, y: 200 },
      1.5,
      { x: 100, y: 100 },
    ],
    [
      "negative window origin (monitor left of primary) — delta can stay positive",
      { x: -200, y: 60 },
      { x: -400, y: 0 },
      2,
      { x: 100, y: 30 },
    ],
    [
      "cursor left of / above the window origin yields negative local coords",
      { x: 50, y: 100 },
      { x: 100, y: 200 },
      1,
      { x: -50, y: -100 },
    ],
    [
      "scaleFactor ≤ 0 falls back to scale 1 (never divide by zero)",
      { x: 150, y: 220 },
      { x: 100, y: 200 },
      0,
      { x: 50, y: 20 },
    ],
  ])("%s", (_name, cursor, origin, scale, expected) => {
    expect(physicalCursorToLocalCss(cursor, origin, scale)).toEqual(expected);
  });

  // Cursor and window origin are the same point space scaled by different monitors' factors:
  // the cursor by the primary's, the origin by the window's own. Readings below are captured
  // from a 2× primary (3456×2234) with the window on a 1× external monitor, alongside the
  // pointermove clientX/clientY they must reproduce.
  it("mixed-DPI — divides the cursor by the primary scale and the origin by the window scale", () => {
    const a = physicalCursorToLocalCss(
      { x: 329.84375, y: -937.0390625 },
      { x: -28, y: -726 },
      1,
      2,
    );
    expect(a.x).toBeCloseTo(192.92, 1); // clientX 193
    expect(a.y).toBeCloseTo(257.48, 1); // clientY 257

    const b = physicalCursorToLocalCss(
      { x: -163.65625, y: -944.0390625 },
      { x: -274, y: -690 },
      1,
      2,
    );
    expect(b.x).toBeCloseTo(192.17, 1); // clientX 192
    expect(b.y).toBeCloseTo(217.98, 1); // clientY 218
  });
});

// ─── createCursorSource — Tauri poll ───────────────────────────────────────────

function fakeWindow(cursorPhys = { x: 300, y: 400 }) {
  let movedCb: (() => void) | undefined;
  let resizedCb: (() => void) | undefined;
  let scaleCb: (() => void) | undefined;
  const unlistenMoved = vi.fn();
  const unlistenResized = vi.fn();
  const unlistenScaleChanged = vi.fn();
  return {
    cursorPosition: vi.fn(async () => ({ ...cursorPhys })),
    outerPosition: vi.fn(async () => ({ x: 100, y: 200 })),
    scaleFactor: vi.fn(async () => 2),
    primaryScaleFactor: vi.fn(async () => 2),
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
type FakeWin = ReturnType<typeof fakeWindow>;

function fakeDoc() {
  let cb: (() => void) | undefined;
  return {
    visibilityState: "visible" as "visible" | "hidden",
    addEventListener: vi.fn((_type: string, listener: () => void) => {
      cb = listener;
    }),
    removeEventListener: vi.fn(),
    fire: () => cb?.(),
  };
}
type FakeDoc = ReturnType<typeof fakeDoc>;

/** schedule() fires poll() without awaiting it — wait out its promise chain. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Drives the poll loop deterministically: `schedule` captures the latest callback + ms. */
function harness(win: FakeWin, doc: FakeDoc = fakeDoc(), intervalMs = 50) {
  const scheduled: number[] = [];
  const cancel = vi.fn();
  let cb: (() => void) | undefined;
  const getWindow = vi.fn(() => win);
  const source = createCursorSource({
    getIntervalMs: () => intervalMs,
    getWindow,
    doc: doc as never,
    schedule: (callback, ms) => {
      cb = callback;
      scheduled.push(ms);
      return scheduled.length;
    },
    cancel,
  });
  const collect = () => {
    const seen: Cursor[] = [];
    const off = source.subscribe((p) => seen.push(p));
    return { seen, off };
  };
  return {
    source,
    scheduled,
    cancel,
    getWindow,
    collect,
    /** Runs the pending timer callback, as if it fired. */
    poll: async (): Promise<void> => {
      const fn = cb;
      cb = undefined;
      fn?.();
      await flush();
    },
  };
}

describe("createCursorSource — Tauri poll", () => {
  beforeEach(() => {
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  });
  afterEach(() => {
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("two subscribers share one cursorPosition() read per tick", async () => {
    const win = fakeWindow();
    const h = harness(win);
    const a = h.collect();
    const b = h.collect();
    expect(h.getWindow).toHaveBeenCalledTimes(1);
    expect(h.scheduled).toEqual([50]);
    await h.poll();
    expect(win.cursorPosition).toHaveBeenCalledTimes(1);
    expect(a.seen).toEqual([{ x: 100, y: 100 }]);
    expect(b.seen).toEqual([{ x: 100, y: 100 }]);
  });

  it("the last unsubscribe stops the reads and removes the window and visibility listeners", async () => {
    const win = fakeWindow();
    const doc = fakeDoc();
    const h = harness(win, doc);
    const a = h.collect();
    const b = h.collect();
    await h.poll();
    a.off();
    expect(h.cancel).not.toHaveBeenCalled();
    b.off();
    await flush();
    expect(h.cancel).toHaveBeenCalledWith(2);
    expect(h.scheduled).toEqual([50, 50]);
    expect(win.unlistenMoved).toHaveBeenCalledTimes(1);
    expect(win.unlistenResized).toHaveBeenCalledTimes(1);
    expect(win.unlistenScaleChanged).toHaveBeenCalledTimes(1);
    expect(doc.removeEventListener).toHaveBeenCalledWith(
      "visibilitychange",
      doc.addEventListener.mock.calls[0][1],
    );
  });

  it("a last unsubscribe before a window listen resolves still releases it once it does", async () => {
    const win = fakeWindow();
    const unlistenMoved = vi.fn();
    let resolveOnMoved: (() => void) | undefined;
    win.onMoved.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveOnMoved = () => resolve(unlistenMoved);
        }),
    );
    const h = harness(win);
    h.collect().off(); // lands before onMoved's promise has resolved
    resolveOnMoved?.();
    await flush();
    expect(unlistenMoved).toHaveBeenCalledTimes(1);
  });

  it("only re-reads outerPosition/scaleFactor/primaryScaleFactor every 8th tick", async () => {
    const win = fakeWindow();
    const h = harness(win);
    h.collect();
    for (let i = 0; i < 8; i++) await h.poll();
    expect(win.cursorPosition).toHaveBeenCalledTimes(8);
    expect(win.outerPosition).toHaveBeenCalledTimes(1);
    expect(win.scaleFactor).toHaveBeenCalledTimes(1);
    expect(win.primaryScaleFactor).toHaveBeenCalledTimes(1);
    await h.poll(); // 9th tick (index 8) ⇒ refresh again
    expect(win.outerPosition).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["move", (w: FakeWin) => w.fireMoved()],
    ["resize", (w: FakeWin) => w.fireResized()],
    ["scale change", (w: FakeWin) => w.fireScaleChanged()],
  ])("a window %s invalidates the cached statics before the next tick", async (_name, fire) => {
    const win = fakeWindow();
    const h = harness(win);
    h.collect();
    await h.poll(); // tick 0 — refreshes
    await h.poll(); // tick 1 — cached
    expect(win.outerPosition).toHaveBeenCalledTimes(1);
    fire(win);
    await h.poll(); // tick 2 — refreshes despite tick % 8 !== 0
    expect(win.outerPosition).toHaveBeenCalledTimes(2);
  });

  // An invalidation landing while a read is in flight leaves that sample unconvertible; a guard
  // that returned before the reschedule would freeze gaze and strand the window click-through.
  it.each([
    ["a cached tick", 1],
    ["a refreshing tick", 0],
  ])("a move landing mid-read on %s skips that sample, and the next tick refreshes and delivers", async (_name, warmTicks) => {
    const win = fakeWindow({ x: 300, y: 400 });
    const h = harness(win);
    const { seen } = h.collect();
    for (let i = 0; i < warmTicks; i++) await h.poll();
    seen.length = 0;
    win.cursorPosition.mockImplementationOnce(async () => {
      win.fireMoved();
      return { x: 300, y: 400 };
    });
    const before = h.scheduled.length;
    await h.poll();
    expect(seen).toEqual([]);
    expect(h.scheduled).toHaveLength(before + 1);

    win.outerPosition.mockClear();
    await h.poll();
    expect(win.outerPosition).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([{ x: 100, y: 100 }]);
  });

  it("setMoving(true) re-reads the window origin every tick, and setMoving(false) restores caching", async () => {
    const win = fakeWindow();
    const h = harness(win);
    h.collect();
    await h.poll(); // tick 0 — refreshes
    h.source.setMoving(true);
    win.outerPosition.mockClear();
    for (let i = 0; i < 4; i++) await h.poll();
    expect(win.outerPosition).toHaveBeenCalledTimes(4);

    h.source.setMoving(false);
    win.outerPosition.mockClear();
    for (let i = 0; i < 3; i++) await h.poll();
    expect(win.outerPosition).toHaveBeenCalledTimes(0);
  });

  it("3 consecutive failures send null to every subscriber once, back off to 1000 ms, and a success restores the cadence", async () => {
    const win = fakeWindow({ x: 300, y: 400 });
    win.cursorPosition.mockRejectedValue(new Error("failed to get cursor position"));
    const h = harness(win);
    const a = h.collect();
    const b = h.collect();
    await h.poll();
    await h.poll();
    expect(a.seen).toEqual([]);
    await h.poll();
    expect(a.seen).toEqual([null]);
    expect(b.seen).toEqual([null]);
    expect(h.scheduled.at(-1)).toBe(1000);
    await h.poll(); // a 4th failure stays backed off without a second null
    expect(a.seen).toEqual([null]);
    expect(h.scheduled.at(-1)).toBe(1000);

    win.cursorPosition.mockResolvedValue({ x: 300, y: 400 });
    await h.poll();
    expect(a.seen).toEqual([null, { x: 100, y: 100 }]);
    expect(h.scheduled.at(-1)).toBe(50);
  });

  it("a hidden document stops the poll and sends null; visible resumes it", async () => {
    const win = fakeWindow();
    const doc = fakeDoc();
    const h = harness(win, doc);
    const { seen } = h.collect();
    await h.poll();
    seen.length = 0;

    doc.visibilityState = "hidden";
    doc.fire();
    expect(seen).toEqual([null]);
    expect(h.cancel).toHaveBeenCalledWith(2);
    win.cursorPosition.mockClear();
    await h.poll(); // a timer that fired before the hide event reads nothing
    expect(win.cursorPosition).not.toHaveBeenCalled();
    const countWhenHidden = h.scheduled.length;

    doc.visibilityState = "visible";
    doc.fire();
    expect(h.scheduled).toHaveLength(countWhenHidden + 1);
    expect(h.scheduled.at(-1)).toBe(50);
  });

  // F1: the null arrives in a microtask, so the caller holds its unsubscribe handle first.
  it.each([
    [
      "the document is hidden",
      async (h: ReturnType<typeof harness>, _win: FakeWin, doc: FakeDoc) => {
        doc.visibilityState = "hidden";
        return h.collect();
      },
      [],
    ],
    [
      "reads keep failing",
      async (h: ReturnType<typeof harness>, win: FakeWin) => {
        const first = h.collect();
        win.cursorPosition.mockRejectedValue(new Error("failed"));
        await h.poll();
        await h.poll();
        await h.poll();
        return first;
      },
      [50, 50, 50, 1000],
    ],
  ])("subscribers joining while %s get null after subscribe returns", async (_name, makeUnavailable, scheduled) => {
    const win = fakeWindow();
    const doc = fakeDoc();
    const h = harness(win, doc);
    const first = await makeUnavailable(h, win, doc);
    const late = h.collect();
    expect(late.seen).toEqual([]);
    await Promise.resolve();
    expect(first.seen).toEqual([null]);
    expect(late.seen).toEqual([null]);
    expect(h.scheduled).toEqual(scheduled);
  });

  it("a read in flight when the last subscriber leaves is not delivered, even to a new subscriber", async () => {
    const win = fakeWindow();
    let resolveCursor: ((v: { x: number; y: number }) => void) | undefined;
    win.cursorPosition.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCursor = resolve;
        }),
    );
    const h = harness(win);
    const first = h.collect();
    void h.poll(); // cursorPosition() is now pending
    first.off();
    const second = h.collect();
    resolveCursor?.({ x: 300, y: 400 });
    await flush();
    expect(first.seen).toEqual([]);
    expect(second.seen).toEqual([]);
    expect(h.scheduled).toEqual([50, 50]);
  });

  it("a subscriber that throws does not stop delivery to the others", async () => {
    const h = harness(fakeWindow());
    h.source.subscribe(() => {
      throw new Error("boom");
    });
    const { seen } = h.collect();
    await h.poll();
    expect(seen).toEqual([{ x: 100, y: 100 }]);
    expect(h.scheduled).toEqual([50, 50]);
  });
});

// ─── createCursorSource — the default Tauri window, per platform ───────────────

describe("createCursorSource — the scale the default window's cursor is converted with", () => {
  beforeEach(() => {
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  });
  afterEach(() => {
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    vi.unstubAllGlobals();
  });

  async function polledLocal(
    cursor: { x: number; y: number },
    origin: { x: number; y: number },
    scale: number,
    primaryScale: number,
  ): Promise<Cursor> {
    const listen = vi.fn(async () => () => {});
    vi.mocked(getCurrentWindow).mockReturnValue({
      outerPosition: vi.fn(async () => origin),
      scaleFactor: vi.fn(async () => scale),
      onMoved: listen,
      onResized: listen,
      onScaleChanged: listen,
    } as never);
    vi.mocked(primaryMonitor).mockResolvedValue({ scaleFactor: primaryScale } as never);
    vi.mocked(cursorPosition).mockResolvedValue(cursor as never);
    let cb: (() => void) | undefined;
    const source = createCursorSource({
      getIntervalMs: () => 33,
      doc: fakeDoc() as never,
      schedule: (callback) => {
        cb = callback;
        return 1;
      },
      cancel: () => {},
    });
    const seen: Cursor[] = [];
    const off = source.subscribe((p) => seen.push(p));
    cb?.();
    await flush();
    off();
    return seen[0] ?? null;
  }

  // Readings from a 1.25× primary (3440×1440) with the window on a 1× monitor to its left:
  // GetCursorPos and the window rect are one physical px space there.
  it("Windows — converts the cursor and the window origin with the window scale alone", async () => {
    vi.stubGlobal("navigator", { platform: "Win32" });
    expect(await polledLocal({ x: -771, y: 1259 }, { x: -973, y: 1008 }, 1, 1.25)).toEqual({
      x: 202,
      y: 251,
    });
  });

  it("macOS — divides the cursor by the primary scale", async () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    const local = await polledLocal({ x: 329.84375, y: -937.0390625 }, { x: -28, y: -726 }, 1, 2);
    expect(local?.x).toBeCloseTo(192.92, 1);
    expect(local?.y).toBeCloseTo(257.48, 1);
  });
});

// ─── createCursorSource — non-Tauri mousemove ──────────────────────────────────

describe("createCursorSource — non-Tauri mousemove path", () => {
  const orig = (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  beforeEach(() => {
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });
  afterEach(() => {
    if (orig === undefined)
      delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    else (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = orig;
  });

  it("forwards mousemove as the cursor and mouseleave as null, and the last unsubscribe removes both listeners", () => {
    const target = new EventTarget();
    const add = vi.spyOn(target, "addEventListener");
    const remove = vi.spyOn(target, "removeEventListener");
    const source = createCursorSource({ getIntervalMs: () => 33, moveTarget: target });
    const seen: Cursor[] = [];
    const off = source.subscribe((p) => seen.push(p));
    target.dispatchEvent(
      Object.assign(new Event("mousemove"), { clientX: 12, clientY: 34 }) as Event,
    );
    target.dispatchEvent(new Event("mouseleave"));
    expect(seen).toEqual([{ x: 12, y: 34 }, null]);
    off();
    expect(remove.mock.calls).toEqual(add.mock.calls);
  });
});
