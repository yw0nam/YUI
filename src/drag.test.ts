/**
 * Tests for src/drag.ts — drag + multi-monitor / DPI (Issue #9, F2 M1).
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

  it("calls drag_window on primary pointerdown (buttons=1)", async () => {
    // PointerEvent is available in Node 18+ via EventTarget (no buttons filter
    // in EventTarget, but we pass it as a custom Event with the right shape).
    const ev = new Event("pointerdown") as Event & { buttons: number };
    (ev as { buttons: number }).buttons = 1;
    el.dispatchEvent(ev);
    // give the microtask queue a tick so the async invoke call fires
    await Promise.resolve();
    expect(mockInvoke).toHaveBeenCalledWith("drag_window");
  });

  it("ignores non-primary button pointerdown (right-click, buttons=2)", async () => {
    const ev = new Event("pointerdown") as Event & { buttons: number };
    (ev as { buttons: number }).buttons = 2;
    el.dispatchEvent(ev);
    await Promise.resolve();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("does not call drag_window after cleanup()", async () => {
    cleanup();
    const ev = new Event("pointerdown") as Event & { buttons: number };
    (ev as { buttons: number }).buttons = 1;
    el.dispatchEvent(ev);
    await Promise.resolve();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("fires __yui_gesture_stub custom event on drag-start (dispatcher #21 seam)", async () => {
    let stubFired = false;
    el.addEventListener("__yui_gesture_stub", () => {
      stubFired = true;
    });
    const ev = new Event("pointerdown") as Event & { buttons: number };
    (ev as { buttons: number }).buttons = 1;
    el.dispatchEvent(ev);
    await Promise.resolve();
    expect(stubFired).toBe(true);
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
});
