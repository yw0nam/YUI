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
}

function fakeWindow(cursorPhys = { x: 0, y: 0 }): FakeWin {
  return {
    cursorPosition: vi.fn(async () => ({ ...cursorPhys })),
    outerPosition: vi.fn(async () => ({ x: 0, y: 0 })),
    scaleFactor: vi.fn(async () => 1),
    primaryScaleFactor: vi.fn(async () => 1),
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
  let cb: (() => void) | undefined;
  const c = createCursorTracker({
    onCursor: (p) => positions.push(p),
    getWindow: () => win as never,
    doc: doc as never,
    schedule: (callback, ms) => {
      cb = callback;
      scheduled.push(ms);
      return scheduled.length;
    },
    cancel: () => {},
  });
  return {
    c,
    positions,
    scheduled,
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
