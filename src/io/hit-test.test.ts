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

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  createHitTestController,
  createTauriHitTestWindow,
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

  it("uniform DPI — an omitted cursor scale keeps the single-factor conversion", () => {
    const p = physicalCursorToLocalCss({ x: 300, y: 400 }, { x: 100, y: 200 }, 2);
    expect(p).toEqual({ x: 100, y: 100 });
  });
});

// ─── decideTransition (hysteresis + debounce state machine) ──────────────────────

const cfg: HitTestConfig = {
  hysteresis_margin_px: 8,
  poll_interval_ms: 33,
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

/** Mirrors src/io/cursor-tracker.test.ts's fakeWindow — same move/resize/scale-change seams. */
function fakeWindow(cursorPhys = { x: 0, y: 0 }): FakeWin {
  let movedCb: (() => void) | undefined;
  let resizedCb: (() => void) | undefined;
  let scaleCb: (() => void) | undefined;
  const unlistenMoved = vi.fn();
  const unlistenResized = vi.fn();
  const unlistenScaleChanged = vi.fn();
  return {
    cursorPosition: vi.fn(async () => ({ ...cursorPhys })),
    setIgnoreCursorEvents: vi.fn(async () => {}),
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

/** Fake document seam (mirrors src/io/cursor-tracker.test.ts's fakeDoc). */
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

/** start() pushes the initial CAPTURE state — flush it so a test sees only its own IPC calls. */
async function startSynced(
  c: ReturnType<typeof createHitTestController>,
  win: FakeWin,
): Promise<void> {
  c.start();
  await vi.waitFor(() => expect(win.setIgnoreCursorEvents).toHaveBeenCalledWith(false));
  win.setIgnoreCursorEvents.mockClear();
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

describe("createHitTestController — start() syncs the window flag", () => {
  beforeEach(() => {
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  });
  afterEach(() => {
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  // The OS-level flag outlives the page: a webview crash or full reload leaves a click-through
  // window, and a fresh controller that assumed "not ignoring" would never receive a pointermove
  // to correct itself — the window stays click-through for good.
  it("pushes ignore=false on start instead of assuming the window state", async () => {
    const win = fakeWindow();
    const c = createHitTestController({
      getWindow: () => win as never,
      moveTarget: new EventTarget(),
      isOverInteractive: () => true,
      getConfig: () => cfg,
      doc: fakeDoc() as never,
    });
    c.start();
    await vi.waitFor(() => expect(win.setIgnoreCursorEvents).toHaveBeenCalledWith(false));
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
      doc: fakeDoc() as never,
    });
    await startSynced(c, win);

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
      doc: fakeDoc() as never,
    });
    await startSynced(c, win);
    // Two non-interactive moves flip to passthrough (ignore=true).
    move(target);
    await Promise.resolve();
    move(target);
    await Promise.resolve();
    await Promise.resolve();
    expect(win.setIgnoreCursorEvents).toHaveBeenLastCalledWith(true);

    // suspend forces back to interactive (ignore=false).
    c.suspend();
    await vi.waitFor(() => expect(win.setIgnoreCursorEvents).toHaveBeenLastCalledWith(false));

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
      doc: fakeDoc() as never,
    });
    await startSynced(c, win);
    c.suspend();
    await Promise.resolve();
    expect(win.setIgnoreCursorEvents).not.toHaveBeenCalled();
    c.stop();
  });

  it('suspend("passthrough") forces click-through through the controller', async () => {
    const win = fakeWindow();
    const c = createHitTestController({
      getWindow: () => win as never,
      moveTarget: new EventTarget(),
      isOverInteractive: () => false,
      getConfig: () => cfg,
      schedule: () => 0,
      cancel: () => {},
      doc: fakeDoc() as never,
    });
    await startSynced(c, win);
    c.suspend("passthrough");
    await Promise.resolve();
    expect(win.setIgnoreCursorEvents).toHaveBeenLastCalledWith(true);

    c.resume();
    await vi.waitFor(() => expect(win.setIgnoreCursorEvents).toHaveBeenLastCalledWith(false));
    c.stop();
  });

  it("ignores a stale owner resume and resumes only for the current owner", async () => {
    const win = fakeWindow();
    const target = new EventTarget();
    const c = createHitTestController({
      getWindow: () => win as never,
      moveTarget: target,
      isOverInteractive: () => false,
      getConfig: () => cfg,
      schedule: () => 0,
      cancel: () => {},
      doc: fakeDoc() as never,
    });
    c.start();
    c.suspend("passthrough", "peek");
    await vi.waitFor(() => expect(win.setIgnoreCursorEvents).toHaveBeenLastCalledWith(true));

    c.suspend("capture");
    await vi.waitFor(() => expect(win.setIgnoreCursorEvents).toHaveBeenLastCalledWith(false));
    win.setIgnoreCursorEvents.mockClear();

    c.resume("peek");
    move(target);
    move(target);
    await Promise.resolve();
    expect(win.setIgnoreCursorEvents).not.toHaveBeenCalled();

    c.resume();
    move(target);
    move(target);
    await vi.waitFor(() => expect(win.setIgnoreCursorEvents).toHaveBeenLastCalledWith(true));
    c.stop();
  });

  it("serializes rapid passthrough suspend and resume flips", async () => {
    let resolveFirst: (() => void) | undefined;
    const win = fakeWindow();
    const c = createHitTestController({
      getWindow: () => win as never,
      moveTarget: new EventTarget(),
      isOverInteractive: () => false,
      getConfig: () => cfg,
      schedule: () => 0,
      cancel: () => {},
      doc: fakeDoc() as never,
    });
    await startSynced(c, win);
    win.setIgnoreCursorEvents
      .mockImplementationOnce(() => new Promise<void>((resolve) => (resolveFirst = resolve)))
      .mockResolvedValue(undefined);
    c.suspend("passthrough");
    c.resume();
    await Promise.resolve();
    expect(win.setIgnoreCursorEvents).toHaveBeenCalledTimes(1);
    resolveFirst?.();
    await vi.waitFor(() => expect(win.setIgnoreCursorEvents).toHaveBeenNthCalledWith(2, false));
    c.stop();
  });
});

// ─── createTauriHitTestWindow — IPC contract ──────────────────────────────────

// ─── createHitTestController — poll failure hardening ────────────────────────
// On Windows, cursorPosition() intermittently throws. After N consecutive
// failures while in PASSTHROUGH the controller must degrade to CAPTURE (safe
// interactive default) instead of staying stranded click-through.

describe("createHitTestController — poll failure hardening", () => {
  beforeEach(() => {
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  });
  afterEach(() => {
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  function makePassthroughController(win: FakeWin): {
    c: ReturnType<typeof import("./hit-test").createHitTestController>;
    scheduledCb: () => Promise<void>;
    target: EventTarget;
  } {
    const target = new EventTarget();
    let cb: (() => void) | undefined;
    const c = createHitTestController({
      getWindow: () => win as never,
      moveTarget: target,
      isOverInteractive: () => false,
      getConfig: () => cfg,
      schedule: (callback) => {
        cb = callback;
        return 0;
      },
      cancel: () => {},
      doc: fakeDoc() as never,
    });
    c.start();
    // Drive two non-interactive moves to flip to PASSTHROUGH.
    const move = (x: number, y: number): void => {
      target.dispatchEvent(
        Object.assign(new Event("pointermove"), { clientX: x, clientY: y }) as Event,
      );
    };
    move(10, 10);
    move(10, 10);
    // Return the scheduled poll callback.
    return { c, scheduledCb: async () => cb?.(), target };
  }

  // Regression: the poll fed one scale factor to both readings, so on a 2× primary with the window
  // on a 1× monitor the converted point landed off the window and PASSTHROUGH never recovered.
  it("converts the polled cursor with the primary scale factor, not the window's", async () => {
    const win = fakeWindow({ x: 400, y: 600 });
    win.outerPosition.mockResolvedValue({ x: 100, y: 100 });
    win.scaleFactor.mockResolvedValue(1);
    win.primaryScaleFactor.mockResolvedValue(2);
    const seen: Array<[number, number]> = [];
    const target = new EventTarget();
    let cb: (() => void) | undefined;
    const c = createHitTestController({
      getWindow: () => win as never,
      moveTarget: target,
      isOverInteractive: (x, y) => {
        seen.push([x, y]);
        return false;
      },
      getConfig: () => cfg,
      schedule: (callback) => {
        cb = callback;
        return 0;
      },
      cancel: () => {},
      doc: fakeDoc() as never,
    });
    c.start();
    const move = (): void =>
      void target.dispatchEvent(
        Object.assign(new Event("pointermove"), { clientX: 10, clientY: 10 }) as Event,
      );
    move();
    move();
    seen.length = 0;

    cb?.();

    // cursor 400/2 − origin 100/1 = 100; y: 600/2 − 100/1 = 200. Single-factor math gives (300, 500).
    await vi.waitFor(() => expect(seen).toContainEqual([100, 200]));
    c.stop();
  });

  it("after 3 consecutive cursorPosition failures in PASSTHROUGH, calls setIgnoreCursorEvents(false) and stops polling", async () => {
    const win = fakeWindow();
    win.cursorPosition.mockRejectedValue(new Error("failed to get cursor position"));
    const { c, scheduledCb } = makePassthroughController(win);
    // Flush the pointermove debounce (ignore=true should have been called).
    await Promise.resolve();
    await Promise.resolve();
    win.setIgnoreCursorEvents.mockClear();

    // Three consecutive poll failures.
    await scheduledCb();
    await Promise.resolve();
    await scheduledCb();
    await Promise.resolve();
    await scheduledCb();
    await Promise.resolve();

    await vi.waitFor(() => expect(win.setIgnoreCursorEvents).toHaveBeenCalledWith(false));
    c.stop();
  });

  it("a single cursorPosition failure followed by a success does NOT force fallback to CAPTURE", async () => {
    const win = fakeWindow({ x: 999, y: 999 }); // far outside interactive zone → stay passthrough
    win.cursorPosition
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValue({ x: 999, y: 999 });
    const { c, scheduledCb } = makePassthroughController(win);
    await Promise.resolve();
    await Promise.resolve();
    win.setIgnoreCursorEvents.mockClear();

    // First poll: failure (counter → 1, but no fallback yet).
    await scheduledCb();
    await Promise.resolve();
    // Second poll: success — failure counter resets; no fallback.
    await scheduledCb();
    await Promise.resolve();

    expect(win.setIgnoreCursorEvents).not.toHaveBeenCalledWith(false);
    c.stop();
  });
});

// ─── createHitTestController — static caching (mirrors cursor-tracker.ts) ────
// The poll only needs a fresh cursorPosition() every tick; outerPosition/scaleFactor/
// primaryScaleFactor describe the window, not the cursor, and only change on a
// move/resize/DPI change — caching them is what makes the 33ms cadence a genuine
// reuse of cursor-tracker.ts's proven POLL_MS rather than a heavier poll under the
// same name.

describe("createHitTestController — static caching", () => {
  beforeEach(() => {
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  });
  afterEach(() => {
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  function makePassthroughController(win: FakeWin): {
    c: ReturnType<typeof createHitTestController>;
    poll: () => Promise<void>;
  } {
    const target = new EventTarget();
    let cb: (() => void) | undefined;
    const c = createHitTestController({
      getWindow: () => win as never,
      moveTarget: target,
      isOverInteractive: () => false,
      getConfig: () => cfg,
      doc: fakeDoc() as never,
      schedule: (callback) => {
        cb = callback;
        return 0;
      },
      cancel: () => {},
    });
    c.start();
    const move = (x: number, y: number): void => {
      target.dispatchEvent(
        Object.assign(new Event("pointermove"), { clientX: x, clientY: y }) as Event,
      );
    };
    move(10, 10);
    move(10, 10);
    return {
      c,
      poll: async (): Promise<void> => {
        const fn = cb;
        cb = undefined;
        await fn?.();
      },
    };
  }

  it("re-reads cursorPosition every poll but outerPosition/scaleFactor/primaryScaleFactor only every 8th", async () => {
    const win = fakeWindow();
    const { c, poll } = makePassthroughController(win);
    win.cursorPosition.mockClear();
    win.outerPosition.mockClear();
    win.scaleFactor.mockClear();
    win.primaryScaleFactor.mockClear();

    for (let i = 0; i < 8; i++) await poll();
    // Tick 0 (entering PASSTHROUGH) refreshes; the next 7 ticks are cached.
    expect(win.cursorPosition).toHaveBeenCalledTimes(8);
    expect(win.outerPosition).toHaveBeenCalledTimes(1);
    expect(win.scaleFactor).toHaveBeenCalledTimes(1);
    expect(win.primaryScaleFactor).toHaveBeenCalledTimes(1);

    await poll(); // 9th poll (tick index 8) ⇒ refresh again
    expect(win.outerPosition).toHaveBeenCalledTimes(2);
    c.stop();
  });

  it("a window move invalidates the cached statics before the next tick", async () => {
    const win = fakeWindow();
    const { c, poll } = makePassthroughController(win);
    win.outerPosition.mockClear();

    await poll(); // tick 0 — refreshes (start-of-PASSTHROUGH)
    await poll(); // tick 1 — cached, no refresh
    expect(win.outerPosition).toHaveBeenCalledTimes(1);

    win.fireMoved(); // window drag moved the window — invalidate now, well before tick 8
    await poll(); // tick 2 — refreshes despite tick % 8 !== 0
    expect(win.outerPosition).toHaveBeenCalledTimes(2);
    c.stop();
  });

  it("stop() unsubscribes the move/resize/scale-change listeners", async () => {
    const win = fakeWindow();
    const { c } = makePassthroughController(win);
    await Promise.resolve(); // let the onMoved/onResized/onScaleChanged promises settle
    c.stop();
    await Promise.resolve();
    expect(win.unlistenMoved).toHaveBeenCalledTimes(1);
    expect(win.unlistenResized).toHaveBeenCalledTimes(1);
    expect(win.unlistenScaleChanged).toHaveBeenCalledTimes(1);
  });
});

// ─── createHitTestController — hidden-window poll gating ─────────────────────
// Nothing can click a hidden window, so the PASSTHROUGH poll must not run while
// document.visibilityState is "hidden" (mirrors src/io/cursor-tracker.ts).

describe("createHitTestController — hidden-window poll gating", () => {
  beforeEach(() => {
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  });
  afterEach(() => {
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  function makePassthroughController(
    win: FakeWin,
    doc: FakeDoc,
  ): {
    c: ReturnType<typeof createHitTestController>;
    scheduled: number[];
    cancel: ReturnType<typeof vi.fn>;
  } {
    const target = new EventTarget();
    const scheduled: number[] = [];
    const cancel = vi.fn();
    const c = createHitTestController({
      getWindow: () => win as never,
      moveTarget: target,
      isOverInteractive: () => false,
      getConfig: () => cfg,
      doc: doc as never,
      schedule: (_callback, ms) => {
        scheduled.push(ms);
        return scheduled.length;
      },
      cancel,
    });
    c.start();
    // Drive two non-interactive moves to flip to PASSTHROUGH.
    const move = (x: number, y: number): void => {
      target.dispatchEvent(
        Object.assign(new Event("pointermove"), { clientX: x, clientY: y }) as Event,
      );
    };
    move(10, 10);
    move(10, 10);
    return { c, scheduled, cancel };
  }

  it("entering PASSTHROUGH while the document is hidden does not schedule a poll", async () => {
    const win = fakeWindow();
    const doc = fakeDoc();
    doc.visibilityState = "hidden";
    const { c, scheduled } = makePassthroughController(win, doc);
    await Promise.resolve();
    await Promise.resolve();
    expect(scheduled).toEqual([]);
    c.stop();
  });

  it("the document going hidden cancels the pending poll", async () => {
    const win = fakeWindow();
    const doc = fakeDoc();
    const { c, scheduled, cancel } = makePassthroughController(win, doc);
    await Promise.resolve();
    await Promise.resolve();
    expect(scheduled).toEqual([cfg.poll_interval_ms]);

    doc.visibilityState = "hidden";
    doc.fire();
    expect(cancel).toHaveBeenCalled();
    c.stop();
  });

  it("becoming visible again resumes the poll while still in PASSTHROUGH", async () => {
    const win = fakeWindow();
    const doc = fakeDoc();
    const { c, scheduled } = makePassthroughController(win, doc);
    await Promise.resolve();
    await Promise.resolve();
    expect(scheduled).toEqual([cfg.poll_interval_ms]);

    doc.visibilityState = "hidden";
    doc.fire();
    doc.visibilityState = "visible";
    doc.fire();
    expect(scheduled).toEqual([cfg.poll_interval_ms, cfg.poll_interval_ms]);
    c.stop();
  });

  it("a poll callback that fires while hidden makes no IPC calls", async () => {
    const win = fakeWindow();
    const doc = fakeDoc();
    const target = new EventTarget();
    let cb: (() => void) | undefined;
    const c = createHitTestController({
      getWindow: () => win as never,
      moveTarget: target,
      isOverInteractive: () => false,
      getConfig: () => cfg,
      doc: doc as never,
      schedule: (callback) => {
        cb = callback;
        return 1;
      },
      cancel: () => {},
    });
    c.start();
    const move = (x: number, y: number): void => {
      target.dispatchEvent(
        Object.assign(new Event("pointermove"), { clientX: x, clientY: y }) as Event,
      );
    };
    move(10, 10);
    move(10, 10);
    await Promise.resolve();
    win.cursorPosition.mockClear();

    doc.visibilityState = "hidden";
    await cb?.();
    expect(win.cursorPosition).not.toHaveBeenCalled();
    c.stop();
  });

  it("a visible event while in CAPTURE schedules nothing", async () => {
    const win = fakeWindow();
    const doc = fakeDoc();
    const scheduled: number[] = [];
    const c = createHitTestController({
      getWindow: () => win as never,
      moveTarget: new EventTarget(),
      isOverInteractive: () => true, // stays CAPTURE
      getConfig: () => cfg,
      doc: doc as never,
      schedule: (_callback, ms) => {
        scheduled.push(ms);
        return scheduled.length;
      },
      cancel: () => {},
    });
    c.start();
    await Promise.resolve();
    doc.fire(); // still visible; onVisibilityChange's "resume" branch requires PASSTHROUGH
    expect(scheduled).toEqual([]);
    c.stop();
  });

  it("a visible event while suspended does not resume the poll", async () => {
    const win = fakeWindow();
    const doc = fakeDoc();
    const target = new EventTarget();
    const scheduled: number[] = [];
    const c = createHitTestController({
      getWindow: () => win as never,
      moveTarget: target,
      isOverInteractive: () => false,
      getConfig: () => cfg,
      doc: doc as never,
      schedule: (_callback, ms) => {
        scheduled.push(ms);
        return scheduled.length;
      },
      cancel: () => {},
    });
    c.start();
    const move = (x: number, y: number): void => {
      target.dispatchEvent(
        Object.assign(new Event("pointermove"), { clientX: x, clientY: y }) as Event,
      );
    };
    move(10, 10);
    move(10, 10); // PASSTHROUGH — one poll scheduled
    expect(scheduled.length).toBe(1);

    c.suspend(); // forces CAPTURE + suspended, stops the poll
    scheduled.length = 0;
    doc.visibilityState = "hidden";
    doc.fire();
    doc.visibilityState = "visible";
    doc.fire();
    expect(scheduled).toEqual([]);
    c.stop();
  });

  it("stop() removes the visibilitychange listener", () => {
    const win = fakeWindow();
    const doc = fakeDoc();
    const c = createHitTestController({
      getWindow: () => win as never,
      moveTarget: new EventTarget(),
      isOverInteractive: () => false,
      getConfig: () => cfg,
      doc: doc as never,
      schedule: () => 0,
      cancel: () => {},
    });
    c.start();
    c.stop();
    expect(doc.removeEventListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  });
});

describe("createTauriHitTestWindow — routes setIgnoreCursorEvents through set_click_through", () => {
  beforeEach(() => {
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    vi.mocked(getCurrentWindow).mockReturnValue({
      outerPosition: vi.fn(async () => ({ x: 0, y: 0 })),
      scaleFactor: vi.fn(async () => 1),
      setIgnoreCursorEvents: vi.fn(async () => {}),
    } as never);
  });
  afterEach(() => {
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    vi.mocked(invoke).mockReset();
  });

  it("setIgnoreCursorEvents(true) calls invoke('set_click_through', { ignore: true })", async () => {
    const w = createTauriHitTestWindow();
    await w.setIgnoreCursorEvents(true);
    expect(invoke).toHaveBeenCalledWith("set_click_through", { ignore: true });
  });

  it("setIgnoreCursorEvents(false) calls invoke('set_click_through', { ignore: false })", async () => {
    const w = createTauriHitTestWindow();
    await w.setIgnoreCursorEvents(false);
    expect(invoke).toHaveBeenCalledWith("set_click_through", { ignore: false });
  });
});
