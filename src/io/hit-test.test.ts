/**
 * Tests for src/io/hit-test.ts — click-through hit-test controller (PHASE-1).
 *
 * Environment: node (vitest default — no jsdom needed; we inject a fake window
 * + a synchronous scheduler so the impure poll loop is fully deterministic).
 *
 * Coverage lives in the PURE helpers:
 *  - physicalCursorToLocalCss: screen-physical px → window-local CSS px
 *    (multi-monitor negative coords + DPI ≠ 1).
 *  - decideTransition: the hysteresis/debounce state machine — no flicker
 *    within margin, N consecutive agreeing samples before a toggle, idempotent.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(),
}));

import {
  createHitTestController,
  decideTransition,
  type HitTestConfig,
  type HitTestState,
  physicalCursorToLocalCss,
} from "./hit-test";

// ─── physicalCursorToLocalCss ──────────────────────────────────────────────────

describe("physicalCursorToLocalCss", () => {
  it("DPI 1 — subtracts the window origin, identity scale", () => {
    const p = physicalCursorToLocalCss({ x: 150, y: 220 }, { x: 100, y: 200 }, 1);
    expect(p).toEqual({ x: 50, y: 20 });
  });

  it("DPI 2 (Retina) — divides the physical delta by the scale factor", () => {
    const p = physicalCursorToLocalCss({ x: 300, y: 400 }, { x: 100, y: 200 }, 2);
    expect(p).toEqual({ x: 100, y: 100 });
  });

  it("DPI 1.5 (Windows HiDPI) — fractional scale", () => {
    const p = physicalCursorToLocalCss({ x: 250, y: 350 }, { x: 100, y: 200 }, 1.5);
    expect(p).toEqual({ x: 100, y: 100 });
  });

  it("negative window origin (monitor left of primary) — delta can stay positive", () => {
    const p = physicalCursorToLocalCss({ x: -200, y: 60 }, { x: -400, y: 0 }, 2);
    expect(p).toEqual({ x: 100, y: 30 });
  });

  it("cursor left of / above the window origin yields negative local coords", () => {
    const p = physicalCursorToLocalCss({ x: 50, y: 100 }, { x: 100, y: 200 }, 1);
    expect(p).toEqual({ x: -50, y: -100 });
  });

  it("scaleFactor ≤ 0 falls back to scale 1 (never divide by zero)", () => {
    const p = physicalCursorToLocalCss({ x: 150, y: 220 }, { x: 100, y: 200 }, 0);
    expect(p).toEqual({ x: 50, y: 20 });
  });
});

// ─── decideTransition (hysteresis + debounce state machine) ──────────────────────

const cfg: HitTestConfig = {
  hysteresis_margin_px: 8,
  poll_interval_ms: 200,
  debounce_samples: 2,
  alpha_threshold: 0.1,
};

function step(
  state: HitTestState,
  interactive: boolean,
  counter: number,
): ReturnType<typeof decideTransition> {
  return decideTransition({ state, interactive, counter, config: cfg });
}

describe("decideTransition — debounce requires N consecutive agreeing samples", () => {
  it("CAPTURE → PASSTHROUGH only after debounce_samples non-interactive samples", () => {
    // first non-interactive sample: counts toward debounce, no toggle yet
    const a = step("capture", false, 0);
    expect(a.state).toBe("capture");
    expect(a.toggle).toBe(false);
    expect(a.counter).toBe(1);

    // second consecutive: reaches debounce_samples=2 → flip + toggle
    const b = step("capture", false, a.counter);
    expect(b.state).toBe("passthrough");
    expect(b.toggle).toBe(true);
    expect(b.counter).toBe(0);
  });

  it("PASSTHROUGH → CAPTURE only after debounce_samples interactive samples", () => {
    const a = step("passthrough", true, 0);
    expect(a.state).toBe("passthrough");
    expect(a.toggle).toBe(false);
    expect(a.counter).toBe(1);

    const b = step("passthrough", true, a.counter);
    expect(b.state).toBe("capture");
    expect(b.toggle).toBe(true);
    expect(b.counter).toBe(0);
  });

  it("a disagreeing sample resets the debounce counter (no flicker on a single blip)", () => {
    const a = step("capture", false, 0); // counter 1
    expect(a.counter).toBe(1);
    const b = step("capture", true, a.counter); // agrees with current state → reset
    expect(b.state).toBe("capture");
    expect(b.toggle).toBe(false);
    expect(b.counter).toBe(0);
  });
});

describe("decideTransition — idempotent (no toggle when already in target state)", () => {
  it("CAPTURE staying interactive never toggles", () => {
    const a = step("capture", true, 0);
    expect(a.state).toBe("capture");
    expect(a.toggle).toBe(false);
    expect(a.counter).toBe(0);
  });

  it("PASSTHROUGH staying non-interactive never toggles", () => {
    const a = step("passthrough", false, 0);
    expect(a.state).toBe("passthrough");
    expect(a.toggle).toBe(false);
    expect(a.counter).toBe(0);
  });
});

// ─── createHitTestController — impure loop seams ─────────────────────────────────

interface FakeWin {
  cursorPosition: ReturnType<typeof vi.fn>;
  setIgnoreCursorEvents: ReturnType<typeof vi.fn>;
  outerPosition: ReturnType<typeof vi.fn>;
  scaleFactor: ReturnType<typeof vi.fn>;
}

function fakeWindow(cursorPhys = { x: 0, y: 0 }): FakeWin {
  return {
    cursorPosition: vi.fn(async () => ({ ...cursorPhys })),
    setIgnoreCursorEvents: vi.fn(async () => {}),
    outerPosition: vi.fn(async () => ({ x: 0, y: 0 })),
    scaleFactor: vi.fn(async () => 1),
  };
}

describe("createHitTestController — Tauri guard", () => {
  const orig = (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  afterEach(() => {
    if (orig === undefined)
      delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    else (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = orig;
  });

  it("is inert when not under Tauri — start() does nothing", () => {
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    const win = fakeWindow();
    const c = createHitTestController({
      getWindow: () => win as never,
      isOverInteractive: () => false,
      getConfig: () => cfg,
    });
    c.start();
    expect(win.setIgnoreCursorEvents).not.toHaveBeenCalled();
    c.stop();
  });
});

describe("createHitTestController — CAPTURE→PASSTHROUGH via pointermove", () => {
  let target: EventTarget;
  beforeEach(() => {
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    target = new EventTarget();
  });
  afterEach(() => {
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("goes click-through after debounce_samples non-interactive moves", async () => {
    const win = fakeWindow();
    const interactive = false;
    const c = createHitTestController({
      getWindow: () => win as never,
      moveTarget: target,
      isOverInteractive: () => interactive,
      getConfig: () => cfg,
      // schedule seam: we drive the poll manually, so swallow scheduling.
      schedule: () => 0,
      cancel: () => {},
    });
    c.start();

    const move = (x: number, y: number): void => {
      target.dispatchEvent(
        Object.assign(new Event("pointermove"), { clientX: x, clientY: y }) as Event,
      );
    };
    move(10, 10); // sample 1 → counter, no toggle
    await Promise.resolve();
    expect(win.setIgnoreCursorEvents).not.toHaveBeenCalled();
    move(10, 10); // sample 2 → toggle ignore=true
    await Promise.resolve();
    await Promise.resolve();
    expect(win.setIgnoreCursorEvents).toHaveBeenCalledWith(true);
    c.stop();
  });
});

describe("createHitTestController — suspend/resume", () => {
  beforeEach(() => {
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  });
  afterEach(() => {
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  const move = (target: EventTarget): void => {
    target.dispatchEvent(
      Object.assign(new Event("pointermove"), { clientX: 0, clientY: 0 }) as Event,
    );
  };

  it("suspend() restores interactive after a passthrough toggle and stops toggling", async () => {
    const win = fakeWindow();
    const target = new EventTarget();
    const c = createHitTestController({
      getWindow: () => win as never,
      moveTarget: target,
      isOverInteractive: () => false,
      getConfig: () => cfg,
      schedule: () => 0,
      cancel: () => {},
    });
    c.start();
    // Two non-interactive moves flip to passthrough (ignore=true).
    move(target);
    await Promise.resolve();
    move(target);
    await Promise.resolve();
    await Promise.resolve();
    expect(win.setIgnoreCursorEvents).toHaveBeenLastCalledWith(true);

    // suspend forces back to interactive (ignore=false).
    c.suspend();
    await Promise.resolve();
    expect(win.setIgnoreCursorEvents).toHaveBeenLastCalledWith(false);

    win.setIgnoreCursorEvents.mockClear();
    // moves during suspend never flip to passthrough
    for (let i = 0; i < 5; i++) {
      move(target);
      await Promise.resolve();
    }
    expect(win.setIgnoreCursorEvents).not.toHaveBeenCalledWith(true);
    c.stop();
  });

  it("is idempotent — suspend() from the initial CAPTURE state makes no IPC call", async () => {
    const win = fakeWindow();
    const c = createHitTestController({
      getWindow: () => win as never,
      moveTarget: new EventTarget(),
      isOverInteractive: () => false,
      getConfig: () => cfg,
      schedule: () => 0,
      cancel: () => {},
    });
    c.start();
    c.suspend();
    await Promise.resolve();
    expect(win.setIgnoreCursorEvents).not.toHaveBeenCalled();
    c.stop();
  });
});
