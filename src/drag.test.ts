/**
 * Tests for src/drag.ts — drag + multi-monitor / DPI.
 *
 * Environment: node (vitest default — no jsdom dependency).
 *
 * Strategy:
 * - `invokeDragWindow` / `invokeGetMonitorsInfo` are thin wrappers around
 *   `@tauri-apps/api/core` `invoke`.  We mock invoke so tests run without a
 *   real Tauri runtime.
 * - `initDrag` attaches a `pointerdown` listener to an EventTarget.  We use a
 *   plain `EventTarget` (available in Node 18+) to test the listener contract
 *   without a full DOM / jsdom.
 * - `physicalToLogical` / `logicalToPhysical` are pure TS helpers that mirror
 *   the Rust functions in src-tauri/src/drag.rs — same test cases keep both
 *   sides in sync.
 * - `clampToWorkArea` is the TS counterpart of Rust `clamp_to_work_area`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock @tauri-apps/api/core before importing drag.ts ─────────────────────
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    onScaleChanged: vi.fn(() => Promise.resolve(() => {})),
  })),
}));

// Captures the window_drop_release handler registered by initDrag.
let capturedDropHandler: (() => void) | undefined;
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_event: string, handler: () => void) => {
    capturedDropHandler = handler;
    return Promise.resolve(() => {});
  }),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  clampToWorkArea,
  initDrag,
  invokeDragWindow,
  invokeGetMonitorsInfo,
  logicalToPhysical,
  type MonitorInfo,
  physicalToLogical,
} from "./drag";

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── invokeDragWindow ────────────────────────────────────────────────────────

describe("invokeDragWindow", () => {
  it("calls invoke with drag_window command", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await invokeDragWindow();
    expect(mockInvoke).toHaveBeenCalledOnce();
    expect(mockInvoke).toHaveBeenCalledWith("drag_window");
  });

  it("propagates errors from invoke", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("OS drag failed"));
    await expect(invokeDragWindow()).rejects.toThrow("OS drag failed");
  });
});

// ─── invokeGetMonitorsInfo ───────────────────────────────────────────────────

describe("invokeGetMonitorsInfo", () => {
  it("calls invoke with get_monitors_info command and returns data", async () => {
    const fakeMonitors: MonitorInfo[] = [
      {
        name: "Built-in Display",
        widthPx: 2560,
        heightPx: 1600,
        xPx: 0,
        yPx: 0,
        scaleFactor: 2.0,
      },
    ];
    mockInvoke.mockResolvedValueOnce(fakeMonitors);
    const result = await invokeGetMonitorsInfo();
    expect(mockInvoke).toHaveBeenCalledWith("get_monitors_info");
    expect(result).toEqual(fakeMonitors);
  });

  it("returns empty array when no monitors available", async () => {
    mockInvoke.mockResolvedValueOnce([]);
    const result = await invokeGetMonitorsInfo();
    expect(result).toEqual([]);
  });
});

// ─── physicalToLogical ───────────────────────────────────────────────────────

describe("physicalToLogical", () => {
  it("1× scale: logical == physical", () => {
    expect(physicalToLogical(1920, 1.0)).toBe(1920);
  });

  it("2× Retina: 2880 physical → 1440 logical", () => {
    expect(physicalToLogical(2880, 2.0)).toBe(1440);
  });

  it("1.5× Windows HiDPI: 2400 physical → 1600 logical", () => {
    expect(physicalToLogical(2400, 1.5)).toBeCloseTo(1600, 9);
  });

  it("returns null for zero scale_factor", () => {
    expect(physicalToLogical(100, 0)).toBeNull();
  });

  it("returns null for negative scale_factor", () => {
    expect(physicalToLogical(100, -1)).toBeNull();
  });
});

// ─── logicalToPhysical ───────────────────────────────────────────────────────

describe("logicalToPhysical", () => {
  it("1× scale: physical == logical", () => {
    expect(logicalToPhysical(600, 1.0)).toBe(600);
  });

  it("2× Retina: 600 logical → 1200 physical", () => {
    expect(logicalToPhysical(600, 2.0)).toBe(1200);
  });

  it("rounds fractional results", () => {
    // 100.3 × 2.0 = 200.6 → 201
    expect(logicalToPhysical(100.3, 2.0)).toBe(201);
  });

  it("returns null for zero scale_factor", () => {
    expect(logicalToPhysical(100, 0)).toBeNull();
  });

  it("returns null for negative scale_factor", () => {
    expect(logicalToPhysical(100, -2)).toBeNull();
  });
});

// ─── round-trip ──────────────────────────────────────────────────────────────

describe("physicalToLogical + logicalToPhysical round-trip", () => {
  it("2× round-trips exactly", () => {
    const physical = 1240;
    const logical = physicalToLogical(physical, 2.0)!;
    expect(logicalToPhysical(logical, 2.0)).toBe(physical);
  });

  it("1.5× round-trips exactly for divisible values", () => {
    const physical = 300;
    const logical = physicalToLogical(physical, 1.5)!;
    expect(logicalToPhysical(logical, 1.5)).toBe(physical);
  });
});

// ─── clampToWorkArea ─────────────────────────────────────────────────────────

describe("clampToWorkArea", () => {
  it("no-op when window is fully inside work area", () => {
    const r = clampToWorkArea(100, 100, 400, 600, 0, 0, 2560, 1440);
    expect(r).toEqual({ x: 100, y: 100 });
  });

  it("clamps left edge", () => {
    const r = clampToWorkArea(-50, 100, 400, 600, 0, 0, 2560, 1440);
    expect(r.x).toBe(0);
  });

  it("clamps right edge", () => {
    // x=2400 + w=400 = 2800 > 2560 → clamped to 2560-400=2160
    const r = clampToWorkArea(2400, 100, 400, 600, 0, 0, 2560, 1440);
    expect(r.x).toBe(2160);
  });

  it("clamps top edge", () => {
    const r = clampToWorkArea(100, -10, 400, 600, 0, 0, 2560, 1440);
    expect(r.y).toBe(0);
  });

  it("clamps bottom edge", () => {
    // y=1000 + h=600 = 1600 > 1440 → clamped to 840
    const r = clampToWorkArea(100, 1000, 400, 600, 0, 0, 2560, 1440);
    expect(r.y).toBe(840);
  });

  it("respects non-zero work area origin (secondary monitor)", () => {
    // Secondary monitor work area starts at x=1920
    const r = clampToWorkArea(1800, 50, 400, 600, 1920, 0, 1920, 1080);
    expect(r.x).toBe(1920); // clamped up to left edge
    expect(r.y).toBe(50);
  });
});

// ─── initDrag ────────────────────────────────────────────────────────────────
// Uses plain EventTarget (Node 18+) — no jsdom required.

describe("initDrag", () => {
  let el: EventTarget;
  let cleanup: () => void;

  beforeEach(async () => {
    el = new EventTarget();
    mockInvoke.mockResolvedValue(undefined);
    // Simulate the Tauri runtime so initDrag takes the full (non-guarded) path.
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    cleanup = await initDrag(el);
  });

  afterEach(() => {
    cleanup();
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    vi.clearAllMocks();
  });

  function down(clientX = 0, clientY = 0, buttons = 1): void {
    const ev = new Event("pointerdown") as Event & {
      buttons: number;
      clientX: number;
      clientY: number;
      pointerId: number;
    };
    Object.assign(ev, { buttons, clientX, clientY, pointerId: 1 });
    el.dispatchEvent(ev);
  }

  function move(clientX: number, clientY: number): void {
    const ev = new Event("pointermove") as Event & {
      clientX: number;
      clientY: number;
      pointerId: number;
    };
    Object.assign(ev, { clientX, clientY, pointerId: 1 });
    el.dispatchEvent(ev);
  }

  it("does not call drag_window on pointerdown alone (no threshold crossed)", async () => {
    down(0, 0);
    await Promise.resolve();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("calls drag_window once after a pointermove crosses the threshold", async () => {
    down(0, 0);
    move(100, 0);
    await Promise.resolve();
    expect(mockInvoke).toHaveBeenCalledWith("drag_window");
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("ignores non-primary button pointerdown (right-click, buttons=2)", async () => {
    down(0, 0, 2);
    move(100, 0);
    await Promise.resolve();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("does not call drag_window after cleanup()", async () => {
    cleanup();
    down(0, 0);
    move(100, 0);
    await Promise.resolve();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("non-Tauri (browser): no-op, never calls getCurrentWindow/invoke, returns cleanup", async () => {
    // Regression: getCurrentWindow() throws in a plain browser; an unguarded
    // initDrag crashed bootstrap before renderer/dispatcher init (Vite = PRD G7
    // screenshot-verification surface). The guard must skip gracefully.
    cleanup(); // tear down the Tauri-path instance from beforeEach
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    vi.clearAllMocks();

    const browserEl = new EventTarget();
    const noop = await initDrag(browserEl); // must NOT throw
    const ev = new Event("pointerdown") as Event & { buttons: number };
    (ev as { buttons: number }).buttons = 1;
    browserEl.dispatchEvent(ev);
    await Promise.resolve();
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(typeof noop).toBe("function");
    noop(); // cleanup must be safe to call
  });

  it("non-Tauri (browser): never fires onDragStart", async () => {
    cleanup(); // tear down the Tauri-path instance from beforeEach
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    vi.clearAllMocks();

    const browserEl = new EventTarget();
    const onDragStart = vi.fn();
    const noop = await initDrag(browserEl, { onDragStart });
    const down = new Event("pointerdown") as Event & { buttons: number; clientX: number };
    Object.assign(down, { buttons: 1, clientX: 0, clientY: 0, pointerId: 1 });
    browserEl.dispatchEvent(down);
    const move = new Event("pointermove") as Event & { clientX: number };
    Object.assign(move, { clientX: 100, clientY: 0, pointerId: 1 });
    browserEl.dispatchEvent(move);
    await Promise.resolve();
    expect(onDragStart).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
    noop();
  });
});

// ─── initDrag — onDragStart gesture DI ─────────────────────────────────────────
// Threshold gesture: onDragStart fires once when a primary pointer drags past the
// move threshold, never on a pure click.

describe("initDrag — onDragStart", () => {
  let el: EventTarget;
  let cleanup: () => void;
  let onDragStart: ReturnType<typeof vi.fn>;

  function down(clientX = 0, clientY = 0, buttons = 1): void {
    const ev = new Event("pointerdown") as Event & {
      buttons: number;
      clientX: number;
      clientY: number;
      pointerId: number;
    };
    Object.assign(ev, { buttons, clientX, clientY, pointerId: 1 });
    el.dispatchEvent(ev);
  }

  function move(clientX: number, clientY: number): void {
    const ev = new Event("pointermove") as Event & {
      clientX: number;
      clientY: number;
      pointerId: number;
    };
    Object.assign(ev, { clientX, clientY, pointerId: 1 });
    el.dispatchEvent(ev);
  }

  function up(): void {
    const ev = new Event("pointerup") as Event & { pointerId: number };
    Object.assign(ev, { pointerId: 1 });
    el.dispatchEvent(ev);
  }

  function cancel(): void {
    const ev = new Event("pointercancel") as Event & { pointerId: number };
    Object.assign(ev, { pointerId: 1 });
    el.dispatchEvent(ev);
  }

  beforeEach(async () => {
    el = new EventTarget();
    onDragStart = vi.fn();
    mockInvoke.mockResolvedValue(undefined);
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    cleanup = await initDrag(el, { onDragStart });
  });

  afterEach(() => {
    cleanup();
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    vi.clearAllMocks();
  });

  it("fires onDragStart + invoke once when the move crosses the threshold", async () => {
    down(0, 0);
    move(100, 0);
    await Promise.resolve();
    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith("drag_window");
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("does not fire onDragStart on pointerup before the threshold (a click)", async () => {
    down(0, 0);
    up();
    await Promise.resolve();
    expect(onDragStart).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("does not fire onDragStart for a sub-threshold move then pointerup", async () => {
    down(0, 0);
    move(1, 1);
    up();
    await Promise.resolve();
    expect(onDragStart).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("fires onDragStart only once across multiple moves past the threshold", async () => {
    down(0, 0);
    move(100, 0);
    move(200, 0);
    move(300, 0);
    await Promise.resolve();
    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("detaches on pointercancel before the threshold; a fresh drag still fires once", async () => {
    // Gesture aborted mid-press, before the threshold — nothing fires.
    down(0, 0);
    cancel();
    await Promise.resolve();
    expect(onDragStart).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
    // Stale move listener from the cancelled gesture must be detached: a move
    // without a fresh pointerdown does nothing.
    move(100, 0);
    await Promise.resolve();
    expect(onDragStart).not.toHaveBeenCalled();
    // A fresh gesture still works and fires exactly once (no double-fire).
    down(0, 0);
    move(100, 0);
    await Promise.resolve();
    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });
});

// ─── initDrag — onDragEnd gesture DI ───────────────────────────────────────────
// onDragEnd fires once per gesture after a threshold-crossing drag releases via
// pointerup or pointercancel. It does NOT fire for sub-threshold press-release (a
// click), and does NOT fire when a drag was never started.

describe("initDrag — onDragEnd", () => {
  let el: EventTarget;
  let cleanup: () => void;
  let onDragStart: ReturnType<typeof vi.fn>;
  let onDragEnd: ReturnType<typeof vi.fn>;

  function down(clientX = 0, clientY = 0, buttons = 1): void {
    const ev = new Event("pointerdown") as Event & {
      buttons: number;
      clientX: number;
      clientY: number;
      pointerId: number;
    };
    Object.assign(ev, { buttons, clientX, clientY, pointerId: 1 });
    el.dispatchEvent(ev);
  }

  function move(clientX: number, clientY: number): void {
    const ev = new Event("pointermove") as Event & {
      clientX: number;
      clientY: number;
      pointerId: number;
    };
    Object.assign(ev, { clientX, clientY, pointerId: 1 });
    el.dispatchEvent(ev);
  }

  function up(): void {
    const ev = new Event("pointerup") as Event & { pointerId: number };
    Object.assign(ev, { pointerId: 1 });
    el.dispatchEvent(ev);
  }

  function cancel(): void {
    const ev = new Event("pointercancel") as Event & { pointerId: number };
    Object.assign(ev, { pointerId: 1 });
    el.dispatchEvent(ev);
  }

  beforeEach(async () => {
    el = new EventTarget();
    onDragStart = vi.fn();
    onDragEnd = vi.fn();
    mockInvoke.mockResolvedValue(undefined);
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    cleanup = await initDrag(el, { onDragStart, onDragEnd });
  });

  afterEach(() => {
    cleanup();
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    vi.clearAllMocks();
  });

  it("fires onDragEnd once on pointerup after a threshold-crossing drag", async () => {
    down(0, 0);
    move(100, 0);
    await Promise.resolve();
    expect(onDragStart).toHaveBeenCalledTimes(1);
    up();
    await Promise.resolve();
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });

  it("fires onDragEnd once on pointercancel after a threshold-crossing drag", async () => {
    down(0, 0);
    move(100, 0);
    await Promise.resolve();
    expect(onDragStart).toHaveBeenCalledTimes(1);
    cancel();
    await Promise.resolve();
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire onDragEnd for a sub-threshold press-release (a click)", async () => {
    down(0, 0);
    up();
    await Promise.resolve();
    expect(onDragStart).not.toHaveBeenCalled();
    expect(onDragEnd).not.toHaveBeenCalled();
  });

  it("does NOT fire onDragEnd for a sub-threshold move then pointerup", async () => {
    down(0, 0);
    move(1, 1);
    up();
    await Promise.resolve();
    expect(onDragStart).not.toHaveBeenCalled();
    expect(onDragEnd).not.toHaveBeenCalled();
  });

  it("fires onDragEnd exactly once per drag gesture, not for every pointerup", async () => {
    down(0, 0);
    move(100, 0);
    await Promise.resolve();
    up();
    await Promise.resolve();
    expect(onDragEnd).toHaveBeenCalledTimes(1);
    // Second gesture: drag again
    down(0, 0);
    move(100, 0);
    await Promise.resolve();
    up();
    await Promise.resolve();
    expect(onDragEnd).toHaveBeenCalledTimes(2);
  });
});

// ─── initDrag — window_drop_release reliability (Windows drag-end fix) ────────
// On Windows the OS modal move loop swallows the webview pointerup, so
// onDragEnd never fires and the hit-test controller stays suspended.
// initDrag must also end the gesture via the reliable window_drop_release event.

describe("initDrag — window_drop_release", () => {
  let el: EventTarget;
  let cleanup: () => void;
  let onDragStart: ReturnType<typeof vi.fn>;
  let onDragEnd: ReturnType<typeof vi.fn>;

  function down(clientX = 0, clientY = 0, buttons = 1): void {
    const ev = new Event("pointerdown") as Event & {
      buttons: number;
      clientX: number;
      clientY: number;
      pointerId: number;
    };
    Object.assign(ev, { buttons, clientX, clientY, pointerId: 1 });
    el.dispatchEvent(ev);
  }

  function move(clientX: number, clientY: number): void {
    const ev = new Event("pointermove") as Event & {
      clientX: number;
      clientY: number;
      pointerId: number;
    };
    Object.assign(ev, { clientX, clientY, pointerId: 1 });
    el.dispatchEvent(ev);
  }

  function up(): void {
    const ev = new Event("pointerup") as Event & { pointerId: number };
    Object.assign(ev, { pointerId: 1 });
    el.dispatchEvent(ev);
  }

  beforeEach(async () => {
    capturedDropHandler = undefined;
    el = new EventTarget();
    onDragStart = vi.fn();
    onDragEnd = vi.fn();
    mockInvoke.mockResolvedValue(undefined);
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    cleanup = await initDrag(el, { onDragStart, onDragEnd });
  });

  afterEach(() => {
    cleanup();
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    vi.clearAllMocks();
  });

  it("fires onDragEnd via window_drop_release when pointerup is withheld (Windows case)", async () => {
    down(0, 0);
    move(100, 0);
    await Promise.resolve();
    expect(onDragStart).toHaveBeenCalledTimes(1);
    // Simulate: OS swallowed pointerup — fire the Tauri event instead.
    capturedDropHandler?.();
    await Promise.resolve();
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });

  it("dedupes: pointerup fires onDragEnd once; subsequent window_drop_release does NOT fire it again", async () => {
    down(0, 0);
    move(100, 0);
    await Promise.resolve();
    up(); // normal end via pointerup
    await Promise.resolve();
    expect(onDragEnd).toHaveBeenCalledTimes(1);
    // Tauri event arrives late (or both fire) — must not double-fire.
    capturedDropHandler?.();
    await Promise.resolve();
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });

  it("dedupes: window_drop_release fires onDragEnd once; subsequent pointerup does NOT fire it again", async () => {
    down(0, 0);
    move(100, 0);
    await Promise.resolve();
    capturedDropHandler?.(); // drop release arrives first (Windows)
    await Promise.resolve();
    expect(onDragEnd).toHaveBeenCalledTimes(1);
    up(); // pointerup arrives late — must not double-fire
    await Promise.resolve();
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });

  it("no-op: window_drop_release with no drag in progress does NOT fire onDragEnd", async () => {
    // No pointerdown at all — stale event from a previous gesture.
    capturedDropHandler?.();
    await Promise.resolve();
    expect(onDragEnd).not.toHaveBeenCalled();
  });

  it("no-op: window_drop_release fires after a sub-threshold press (no drag started)", async () => {
    down(0, 0);
    // No pointermove past threshold — drag never started.
    capturedDropHandler?.();
    await Promise.resolve();
    expect(onDragEnd).not.toHaveBeenCalled();
  });

  it("second gesture works correctly after a window_drop_release end", async () => {
    down(0, 0);
    move(100, 0);
    await Promise.resolve();
    capturedDropHandler?.();
    await Promise.resolve();
    expect(onDragEnd).toHaveBeenCalledTimes(1);
    // Second gesture.
    down(0, 0);
    move(100, 0);
    await Promise.resolve();
    up();
    await Promise.resolve();
    expect(onDragEnd).toHaveBeenCalledTimes(2);
  });

  it("no phantom drag: a hover move after a window_drop_release end starts no new drag", async () => {
    down(0, 0);
    move(100, 0);
    await Promise.resolve();
    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    // OS swallowed pointerup; the gesture ends via the Tauri event, which detaches
    // the gesture listeners.
    capturedDropHandler?.();
    await Promise.resolve();
    expect(onDragEnd).toHaveBeenCalledTimes(1);
    // A subsequent hover move (no fresh pointerdown) must not start a new drag.
    move(500, 0);
    await Promise.resolve();
    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });
});

// ─── initDrag — orbit gesture (Alt/Option + left-drag) ─────────────────────────
// Alt/Option + left-drag rotates the camera (azimuth/polar deltas) instead of
// moving the OS window. The modifier branch fully consumes the gesture: it
// preventDefaults + captures the pointer, never fires onDragStart, and never
// invokes drag_window. It works WITHOUT the Tauri runtime (pure JS callback) so
// the browser screenshot-verification surface can drive it too. Plain left-drag is
// unchanged.

describe("initDrag — orbit gesture (Alt + left-drag)", () => {
  let el: EventTarget;
  let cleanup: () => void;
  let onDragStart: ReturnType<typeof vi.fn>;
  let onOrbit: ReturnType<typeof vi.fn>;

  function down(clientX = 0, clientY = 0, buttons = 1, altKey = false): Event {
    const ev = new Event("pointerdown", { cancelable: true }) as Event & {
      buttons: number;
      clientX: number;
      clientY: number;
      pointerId: number;
      altKey: boolean;
    };
    Object.assign(ev, { buttons, clientX, clientY, pointerId: 1, altKey });
    el.dispatchEvent(ev);
    return ev;
  }

  function move(clientX: number, clientY: number, altKey = false): void {
    const ev = new Event("pointermove", { cancelable: true }) as Event & {
      clientX: number;
      clientY: number;
      pointerId: number;
      altKey: boolean;
    };
    Object.assign(ev, { clientX, clientY, pointerId: 1, altKey });
    el.dispatchEvent(ev);
  }

  function up(): void {
    const ev = new Event("pointerup") as Event & { pointerId: number };
    Object.assign(ev, { pointerId: 1 });
    el.dispatchEvent(ev);
  }

  beforeEach(async () => {
    el = new EventTarget();
    onDragStart = vi.fn();
    onOrbit = vi.fn();
    mockInvoke.mockResolvedValue(undefined);
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    cleanup = await initDrag(el, { onDragStart, onOrbit });
  });

  afterEach(() => {
    cleanup();
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    vi.clearAllMocks();
  });

  it("Alt+left drag routes to onOrbit with pointer deltas, not window-move", async () => {
    down(10, 10, 1, true);
    move(40, 25, true); // dx=30, dy=15
    await Promise.resolve();
    expect(onOrbit).toHaveBeenCalledTimes(1);
    expect(onOrbit).toHaveBeenCalledWith({ dx: 30, dy: 15 });
    // Window-move path must NOT engage.
    expect(onDragStart).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("accumulates deltas relative to the previous move (not the start point)", async () => {
    down(0, 0, 1, true);
    move(10, 0, true);
    move(25, 0, true); // dx from previous = 15
    await Promise.resolve();
    expect(onOrbit).toHaveBeenNthCalledWith(1, { dx: 10, dy: 0 });
    expect(onOrbit).toHaveBeenNthCalledWith(2, { dx: 15, dy: 0 });
  });

  it("consumes the gesture: preventDefault on the modifier pointerdown", () => {
    const ev = down(0, 0, 1, true);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("ends on pointerup: a later move fires no further onOrbit", async () => {
    down(0, 0, 1, true);
    move(20, 0, true);
    await Promise.resolve();
    expect(onOrbit).toHaveBeenCalledTimes(1);
    up();
    move(80, 0, true);
    await Promise.resolve();
    expect(onOrbit).toHaveBeenCalledTimes(1);
  });

  it("plain left-drag (no Alt) does NOT orbit — window-move still engages", async () => {
    down(0, 0, 1, false);
    move(100, 0, false);
    await Promise.resolve();
    expect(onOrbit).not.toHaveBeenCalled();
    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith("drag_window");
  });

  it("Alt + non-primary button does not orbit", async () => {
    down(0, 0, 2, true); // right button + Alt
    move(50, 0, true);
    await Promise.resolve();
    expect(onOrbit).not.toHaveBeenCalled();
  });

  it("after cleanup() an Alt+left drag no longer orbits", async () => {
    cleanup();
    down(0, 0, 1, true);
    move(50, 0, true);
    await Promise.resolve();
    expect(onOrbit).not.toHaveBeenCalled();
  });
});

describe("initDrag — orbit gesture works without the Tauri runtime (browser)", () => {
  it("Alt+left drag fires onOrbit in a plain browser; never invokes drag_window", async () => {
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    vi.clearAllMocks();
    const el = new EventTarget();
    const onOrbit = vi.fn();
    const onDragStart = vi.fn();
    const cleanup = await initDrag(el, { onOrbit, onDragStart });

    const down = new Event("pointerdown", { cancelable: true }) as Event & {
      buttons: number;
      clientX: number;
      clientY: number;
      pointerId: number;
      altKey: boolean;
    };
    Object.assign(down, { buttons: 1, clientX: 0, clientY: 0, pointerId: 1, altKey: true });
    el.dispatchEvent(down);
    const move = new Event("pointermove", { cancelable: true }) as Event & {
      clientX: number;
      clientY: number;
      pointerId: number;
      altKey: boolean;
    };
    Object.assign(move, { clientX: 30, clientY: 0, pointerId: 1, altKey: true });
    el.dispatchEvent(move);
    await Promise.resolve();

    expect(onOrbit).toHaveBeenCalledWith({ dx: 30, dy: 0 });
    expect(onDragStart).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
    cleanup();
  });
});

// ─── initDrag — onOrbitStart / onOrbitEnd lifecycle ────────────────────────────
// onOrbitStart fires once when an Alt+left orbit gesture commits (pointerdown with
// altKey + buttons=1). onOrbitEnd fires once on pointerup and also once on
// pointercancel. Neither fires for a plain (non-Alt) left-drag.

describe("initDrag — onOrbitStart / onOrbitEnd", () => {
  let el: EventTarget;
  let cleanup: () => void;
  let onOrbitStart: ReturnType<typeof vi.fn>;
  let onOrbitEnd: ReturnType<typeof vi.fn>;

  function down(clientX = 0, clientY = 0, buttons = 1, altKey = false): void {
    const ev = new Event("pointerdown", { cancelable: true }) as Event & {
      buttons: number;
      clientX: number;
      clientY: number;
      pointerId: number;
      altKey: boolean;
    };
    Object.assign(ev, { buttons, clientX, clientY, pointerId: 1, altKey });
    el.dispatchEvent(ev);
  }

  function up(): void {
    const ev = new Event("pointerup") as Event & { pointerId: number };
    Object.assign(ev, { pointerId: 1 });
    el.dispatchEvent(ev);
  }

  function cancel(): void {
    const ev = new Event("pointercancel") as Event & { pointerId: number };
    Object.assign(ev, { pointerId: 1 });
    el.dispatchEvent(ev);
  }

  beforeEach(async () => {
    el = new EventTarget();
    onOrbitStart = vi.fn();
    onOrbitEnd = vi.fn();
    mockInvoke.mockResolvedValue(undefined);
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    cleanup = await initDrag(el, { onOrbitStart, onOrbitEnd });
  });

  afterEach(() => {
    cleanup();
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    vi.clearAllMocks();
  });

  it("Alt+left pointerdown fires onOrbitStart exactly once", async () => {
    down(0, 0, 1, true);
    await Promise.resolve();
    expect(onOrbitStart).toHaveBeenCalledTimes(1);
  });

  it("pointerup after Alt+left pointerdown fires onOrbitEnd exactly once", async () => {
    down(0, 0, 1, true);
    up();
    await Promise.resolve();
    expect(onOrbitEnd).toHaveBeenCalledTimes(1);
  });

  it("pointercancel after Alt+left pointerdown fires onOrbitEnd exactly once", async () => {
    down(0, 0, 1, true);
    cancel();
    await Promise.resolve();
    expect(onOrbitEnd).toHaveBeenCalledTimes(1);
  });

  it("plain left-drag (no altKey) fires neither onOrbitStart nor onOrbitEnd", async () => {
    down(0, 0, 1, false);
    up();
    await Promise.resolve();
    expect(onOrbitStart).not.toHaveBeenCalled();
    expect(onOrbitEnd).not.toHaveBeenCalled();
  });
});
