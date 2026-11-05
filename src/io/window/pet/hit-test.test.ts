/**
 * Tests for src/io/window/pet/hit-test.ts — click-through hit-test controller (PHASE-1).
 *
 * Environment: node (vitest default — no jsdom needed). A fake cursor source stands in for
 * src/io/window/pet/cursor-source.ts so PASSTHROUGH samples are delivered by hand; one case
 * runs the real source against a hidden document.
 *
 *  - decideTransition: the hysteresis/debounce state machine — no flicker
 *    within margin, N consecutive agreeing samples before a toggle, idempotent.
 *  - createHitTestController: pointermove drives CAPTURE, the cursor source drives
 *    PASSTHROUGH and is subscribed only there.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import type { HitTestKnobs } from "../../../config/validators/avatar/types";
import { createCursorSource } from "./cursor-source";
import {
  createHitTestController,
  createTauriHitTestWindow,
  decideTransition,
  type HitTestState,
} from "./hit-test";

// ─── decideTransition (hysteresis + debounce state machine) ──────────────────────

const cfg: HitTestKnobs = {
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

// ─── createHitTestController ─────────────────────────────────────────────────────

type Cursor = { x: number; y: number } | null;

function fakeWindow() {
  return { setIgnoreCursorEvents: vi.fn(async () => {}) };
}
type FakeWin = ReturnType<typeof fakeWindow>;

/** Stands in for the shared cursor source: `send` delivers a sample to every subscriber. */
function fakeCursor() {
  const listeners = new Set<(pos: Cursor) => void>();
  return {
    subscribe: vi.fn((listener: (pos: Cursor) => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    }),
    setMoving: vi.fn(),
    send(pos: Cursor) {
      for (const listener of [...listeners]) listener(pos);
    },
    get subscribers() {
      return listeners.size;
    },
  };
}

const flushIpc = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

/** start() pushes the initial CAPTURE state — flush it so a test sees only its own IPC calls. */
async function startSynced(
  c: ReturnType<typeof createHitTestController>,
  win: FakeWin,
): Promise<void> {
  c.start();
  await vi.waitFor(() => expect(win.setIgnoreCursorEvents).toHaveBeenCalledWith(false));
  win.setIgnoreCursorEvents.mockClear();
}

function setup(opts: { interactive?: () => boolean } = {}) {
  const win = fakeWindow();
  const cursor = fakeCursor();
  const target = new EventTarget();
  const seen: Array<[number, number, number]> = [];
  const c = createHitTestController({
    cursor,
    getWindow: () => win,
    moveTarget: target,
    isOverInteractive: (x, y, margin) => {
      seen.push([x, y, margin]);
      return opts.interactive?.() ?? false;
    },
    getConfig: () => cfg,
  });
  const move = (x = 10, y = 10): void =>
    void target.dispatchEvent(
      Object.assign(new Event("pointermove"), { clientX: x, clientY: y }) as Event,
    );
  return { win, cursor, target, seen, c, move };
}

/** Two non-interactive moves flip CAPTURE → PASSTHROUGH. */
async function toPassthrough(s: ReturnType<typeof setup>): Promise<void> {
  await startSynced(s.c, s.win);
  s.move();
  s.move();
  await flushIpc();
  expect(s.win.setIgnoreCursorEvents).toHaveBeenLastCalledWith(true);
  s.win.setIgnoreCursorEvents.mockClear();
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
    const s = setup();
    s.c.start();
    expect(s.win.setIgnoreCursorEvents).not.toHaveBeenCalled();
    s.c.stop();
  });
});

describe("createHitTestController", () => {
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
    const s = setup({ interactive: () => true });
    s.c.start();
    await vi.waitFor(() => expect(s.win.setIgnoreCursorEvents).toHaveBeenCalledWith(false));
    s.c.stop();
  });

  it("goes click-through after debounce_samples non-interactive moves and only then subscribes to the cursor", async () => {
    const s = setup();
    await startSynced(s.c, s.win);
    s.move();
    await flushIpc();
    expect(s.win.setIgnoreCursorEvents).not.toHaveBeenCalled();
    expect(s.cursor.subscribers).toBe(0);
    s.move();
    await flushIpc();
    expect(s.win.setIgnoreCursorEvents).toHaveBeenCalledWith(true);
    expect(s.cursor.subscribers).toBe(1);
    expect(s.seen).toEqual([
      [10, 10, cfg.hysteresis_margin_px],
      [10, 10, cfg.hysteresis_margin_px],
    ]);
    s.c.stop();
  });

  it("debounce_samples interactive cursor samples (tight box) return to CAPTURE and release the cursor", async () => {
    let interactive = false;
    const s = setup({ interactive: () => interactive });
    await toPassthrough(s);
    s.seen.length = 0;
    interactive = true;
    s.cursor.send({ x: 40, y: 50 });
    await flushIpc();
    expect(s.win.setIgnoreCursorEvents).not.toHaveBeenCalled();
    s.cursor.send({ x: 40, y: 50 });
    await flushIpc();
    expect(s.win.setIgnoreCursorEvents).toHaveBeenCalledWith(false);
    expect(s.cursor.subscribers).toBe(0);
    expect(s.seen).toEqual([
      [40, 50, 0],
      [40, 50, 0],
    ]);
    s.c.stop();
  });

  it.each([
    ["a null cursor sample", (s: ReturnType<typeof setup>) => s.cursor.send(null)],
    ["suspend()", (s: ReturnType<typeof setup>) => s.c.suspend()],
    ["stop()", (s: ReturnType<typeof setup>) => s.c.stop()],
  ])("leaving PASSTHROUGH by %s forces the window interactive and releases the cursor", async (_name, leave) => {
    const s = setup();
    await toPassthrough(s);
    leave(s);
    await flushIpc();
    expect(s.win.setIgnoreCursorEvents).toHaveBeenCalledWith(false);
    expect(s.cursor.subscribers).toBe(0);
    s.c.stop();
  });

  it("setMoving forwards to the cursor source", () => {
    const s = setup();
    s.c.setMoving(true);
    expect(s.cursor.setMoving).toHaveBeenCalledWith(true);
  });

  // Nothing can click a hidden window: the shared source sends null, and the window must not stay
  // click-through holding a subscription that keeps nothing polling.
  it("entering PASSTHROUGH while the document is hidden returns to CAPTURE and releases the source", async () => {
    const doc = {
      visibilityState: "hidden",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const scheduled: number[] = [];
    const source = createCursorSource({
      getIntervalMs: () => 33,
      getWindow: () => ({
        cursorPosition: vi.fn(async () => ({ x: 0, y: 0 })),
        outerPosition: vi.fn(async () => ({ x: 0, y: 0 })),
        scaleFactor: vi.fn(async () => 1),
        onMoved: vi.fn(async () => () => {}),
        onResized: vi.fn(async () => () => {}),
        onScaleChanged: vi.fn(async () => () => {}),
      }),
      doc: doc as never,
      schedule: (_cb, ms) => scheduled.push(ms),
      cancel: () => {},
    });
    const win = fakeWindow();
    const target = new EventTarget();
    const c = createHitTestController({
      cursor: source,
      getWindow: () => win,
      moveTarget: target,
      isOverInteractive: () => false,
      getConfig: () => cfg,
    });
    await startSynced(c, win);
    for (let i = 0; i < 2; i++) {
      target.dispatchEvent(
        Object.assign(new Event("pointermove"), { clientX: 10, clientY: 10 }) as Event,
      );
    }
    await vi.waitFor(() => expect(win.setIgnoreCursorEvents).toHaveBeenLastCalledWith(false));
    expect(win.setIgnoreCursorEvents.mock.calls).toEqual([[true], [false]]);
    expect(doc.removeEventListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    expect(scheduled).toEqual([]);
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

  it("suspend() stops toggling: moves during suspend never flip to passthrough", async () => {
    const s = setup();
    await toPassthrough(s);
    s.c.suspend();
    await vi.waitFor(() => expect(s.win.setIgnoreCursorEvents).toHaveBeenLastCalledWith(false));
    s.win.setIgnoreCursorEvents.mockClear();
    for (let i = 0; i < 5; i++) s.move();
    await flushIpc();
    expect(s.win.setIgnoreCursorEvents).not.toHaveBeenCalledWith(true);
    expect(s.cursor.subscribers).toBe(0);
    s.c.stop();
  });

  it("resume() after suspend() lets moves flip to passthrough again", async () => {
    const s = setup();
    await startSynced(s.c, s.win);
    s.c.suspend();
    s.c.resume();
    s.move();
    s.move();
    await vi.waitFor(() => expect(s.win.setIgnoreCursorEvents).toHaveBeenLastCalledWith(true));
    s.c.stop();
  });

  it("resume() without a suspension leaves a passthrough window in passthrough", async () => {
    const s = setup();
    await toPassthrough(s);
    s.c.resume();
    await flushIpc();
    expect(s.win.setIgnoreCursorEvents).not.toHaveBeenCalled();
    expect(s.cursor.subscribers).toBe(1);
    s.c.stop();
  });

  it("is idempotent — suspend() from the initial CAPTURE state makes no IPC call", async () => {
    const s = setup();
    await startSynced(s.c, s.win);
    s.c.suspend();
    await flushIpc();
    expect(s.win.setIgnoreCursorEvents).not.toHaveBeenCalled();
    s.c.stop();
  });

  it("serializes rapid click-through flips", async () => {
    let resolveFirst: (() => void) | undefined;
    const s = setup();
    await startSynced(s.c, s.win);
    s.win.setIgnoreCursorEvents
      .mockImplementationOnce(() => new Promise<void>((resolve) => (resolveFirst = resolve)))
      .mockResolvedValue(undefined);
    s.move();
    s.move();
    s.c.suspend();
    await Promise.resolve();
    expect(s.win.setIgnoreCursorEvents).toHaveBeenCalledTimes(1);
    resolveFirst?.();
    await vi.waitFor(() => expect(s.win.setIgnoreCursorEvents).toHaveBeenNthCalledWith(2, false));
    s.c.stop();
  });
});

// ─── createTauriHitTestWindow — IPC contract ──────────────────────────────────

describe("createTauriHitTestWindow — routes setIgnoreCursorEvents through set_click_through", () => {
  beforeEach(() => {
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
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
