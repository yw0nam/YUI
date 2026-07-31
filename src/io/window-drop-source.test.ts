/**
 * window-drop-source.test.ts — window-drop release → bus envelope producer.
 *
 * The producer translates the Rust `window_drop_release` event into bus
 * envelopes. It is client-firing, backend-bypassed (firing ≠ judgment):
 *  - seat in a window's top-edge catch zone → `user.window_sit_drop` carrying
 *    the chosen (topmost) window rect + the edge in pet-window-local px.
 *  - seat over no window → `user.window_sit_exit`.
 *  - no perch probe (no VRM / projection failed) → `user.window_sit_exit`.
 *
 * The real `perch-geometry` (petPxToGlobalPoints / inCatchZone) is exercised —
 * only the GL/OS seams (renderer probe, Tauri window position/scale, list_windows)
 * are mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GESTURE_CUES_DEFAULTS, PEEK_DEFAULTS } from "../config/load";
import type { WindowRect } from "../contract";
import type { BusEnvelope, EventBus } from "../dispatcher/event-bus";
import {
  createWindowDropSource as createWindowDropSourceImpl,
  type WindowDropSourceDeps,
} from "./window-drop-source";

function createWindowDropSource(
  deps: Omit<WindowDropSourceDeps, "getPeekConfig" | "getGestureCues"> &
    Partial<Pick<WindowDropSourceDeps, "getPeekConfig" | "getGestureCues">>,
) {
  return createWindowDropSourceImpl({
    ...deps,
    getPeekConfig: deps.getPeekConfig ?? (() => PEEK_DEFAULTS),
    getGestureCues: deps.getGestureCues ?? (() => GESTURE_CUES_DEFAULTS),
  });
}

const RELEASE_EVENT = "window_drop_release";

/** Minimal in-memory bus capturing pushes. */
function makeBus(): { bus: EventBus; pushed: BusEnvelope[] } {
  const pushed: BusEnvelope[] = [];
  const bus: EventBus = {
    push(env) {
      pushed.push(env);
      return true;
    },
    pop() {
      return null;
    },
    snapshot() {
      return [...pushed];
    },
  };
  return { bus, pushed };
}

/** A fake Tauri window with controllable outer position + scale factor. */
function makeWindow(pos: { x: number; y: number }, scale: number) {
  return {
    outerPosition: vi.fn(async () => ({ x: pos.x, y: pos.y })),
    scaleFactor: vi.fn(async () => scale),
  };
}

/** A fake Tauri `listen` that captures the handler so the test can fire releases. */
function makeListen() {
  const handlers: Array<(e: { payload: unknown }) => void> = [];
  const unlisten = vi.fn();
  const listen = vi.fn(async (_event: string, handler: (e: { payload: unknown }) => void) => {
    handlers.push(handler);
    return unlisten;
  });
  function fire(payload: unknown): void {
    for (const h of handlers) h({ payload });
  }
  return { listen, fire, unlisten, handlers };
}

const win = (over: Partial<WindowRect> = {}): WindowRect => ({
  x: 300,
  y: 400,
  width: 520,
  height: 320,
  name: "Other",
  ownerName: "Visual Studio Code",
  pid: 999,
  windowNumber: 7,
  ...over,
});

let bus: EventBus;
let pushed: BusEnvelope[];

beforeEach(() => {
  ({ bus, pushed } = makeBus());
});

describe("window-drop-source — perch hit", () => {
  it("pushes user.window_sit_drop with the chosen window rect + edge_local_ypx when the seat lands in a catch zone", async () => {
    // seat probe → pet-window px; window pos/scale chosen so seat lands inside WIN.
    // probe seatPx (40, 30); pet outer pos physical (520, 740) at scale 2 →
    // winOriginPts = (260, 370); seatGlobal = (300, 400) which is the WIN top-left corner.
    const renderer = {
      getPerchProbe: vi.fn(() => ({ seatPx: { x: 40, y: 30 }, charHpx: 200 })),
      isPerched: vi.fn(() => true),
    };
    const W = win();
    const invoke = vi.fn(async () => [W]);
    const getWindow = () => makeWindow({ x: 520, y: 740 }, 2);
    const { listen, fire } = makeListen();

    const source = createWindowDropSource({ bus, renderer, invoke, getWindow, listen });
    await source.start();
    fire({ point: { x: 123, y: 456 } });
    // allow the async release handler to settle
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(invoke).toHaveBeenCalledWith("list_windows");
    expect(pushed).toHaveLength(2);
    const env = pushed.find((e) => e.event_name === "user.window_sit_drop")!;
    expect(env.source).toBe("os_event_watcher");
    expect(env.hint_tier).toBe(1);
    expect(env.dnd_override).toBe(true);
    expect(env.payload?.app).toBe("Visual Studio Code");
    expect(env.payload?.window_title).toBe("Other");
    // edge_local_ypx = W.y - pos.y/scale = 400 - 740/2 = 400 - 370 = 30.
    expect(env.payload?.edge_local_ypx).toBeCloseTo(30, 6);
  });

  it("also pushes proactive.window_sit composing the sat-on window name into the cue context", async () => {
    const renderer = {
      getPerchProbe: vi.fn(() => ({ seatPx: { x: 40, y: 30 }, charHpx: 200 })),
      isPerched: vi.fn(() => true),
    };
    const W = win({ name: "Notes" });
    const invoke = vi.fn(async () => [W]);
    const getWindow = () => makeWindow({ x: 520, y: 740 }, 2);
    const { listen, fire } = makeListen();

    const source = createWindowDropSource({ bus, renderer, invoke, getWindow, listen });
    await source.start();
    fire({ point: { x: 123, y: 456 } });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const env = pushed.find((e) => e.event_name === "proactive.window_sit")!;
    expect(env).toBeDefined();
    expect(env.source).toBe("os_event_watcher");
    expect(env.hint_tier).toBe(2);
    expect(env.payload).toEqual({
      cue_id: "window_sit",
      label: GESTURE_CUES_DEFAULTS.window_sit.label,
      context: `${GESTURE_CUES_DEFAULTS.window_sit.context} (currently perched on: Notes)`,
    });
  });

  it("proactive.window_sit context has no perch suffix when the target window has no name", async () => {
    const renderer = {
      getPerchProbe: vi.fn(() => ({ seatPx: { x: 40, y: 30 }, charHpx: 200 })),
      isPerched: vi.fn(() => true),
    };
    const W = win({ name: null });
    const invoke = vi.fn(async () => [W]);
    const getWindow = () => makeWindow({ x: 520, y: 740 }, 2);
    const { listen, fire } = makeListen();

    const source = createWindowDropSource({ bus, renderer, invoke, getWindow, listen });
    await source.start();
    fire({ point: { x: 123, y: 456 } });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const env = pushed.find((e) => e.event_name === "proactive.window_sit")!;
    expect(env.payload?.context).toBe(GESTURE_CUES_DEFAULTS.window_sit.context);
  });

  it("chooses the topmost (first front-to-back) window when several overlap the seat", async () => {
    const renderer = {
      getPerchProbe: vi.fn(() => ({ seatPx: { x: 40, y: 30 }, charHpx: 200 })),
      isPerched: vi.fn(() => true),
    };
    // Distinct top edges (both catch the seat at global y=400) so the emitted
    // edge_local_ypx reveals which window won: top y=400 → 30, back y=440 → 70.
    const top = win({ name: "Top", pid: 1, y: 400 });
    const back = win({ name: "Back", pid: 2, y: 440 });
    // list_windows is front-to-back → first match (top) wins.
    const invoke = vi.fn(async () => [top, back]);
    const getWindow = () => makeWindow({ x: 520, y: 740 }, 2);
    const { listen, fire } = makeListen();

    const source = createWindowDropSource({ bus, renderer, invoke, getWindow, listen });
    await source.start();
    fire({ point: { x: 0, y: 0 } });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(pushed).toHaveLength(2);
    // edge = top.y - pos.y/scale = 400 - 740/2 = 30 (back would give 70).
    const env = pushed.find((e) => e.event_name === "user.window_sit_drop")!;
    expect(env.payload?.edge_local_ypx).toBeCloseTo(30, 6);
  });
});

describe("window-drop-source — no perch", () => {
  it("pushes user.window_sit_exit when the matched window's edge is covered by a front window at the seat", async () => {
    const renderer = {
      getPerchProbe: vi.fn(() => ({ seatPx: { x: 40, y: 30 }, charHpx: 200 })),
      isPerched: vi.fn(() => true),
    };
    // seatGlobal = (300, 400). Front's RECT contains the seat (its surface is what
    // the user sees there) but its own top-edge catch zone ([44,146]) does not;
    // Behind's catch zone does (top edge at y=400). Perching on Behind would seat
    // the character on an invisible edge — must be a miss, not a drop.
    const front = win({ name: "Front", x: 100, y: 100, width: 600, height: 700, windowNumber: 11 });
    const behind = win({ name: "Behind", windowNumber: 22 });
    const invoke = vi.fn(async () => [front, behind]);
    const getWindow = () => makeWindow({ x: 520, y: 740 }, 2);
    const { listen, fire } = makeListen();

    const source = createWindowDropSource({ bus, renderer, invoke, getWindow, listen });
    await source.start();
    fire({ point: { x: 0, y: 0 } });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(pushed).toHaveLength(1);
    expect(pushed[0].event_name).toBe("user.window_sit_exit");
    expect(pushed[0].payload).toBeUndefined();
  });

  it("pushes user.window_sit_exit (no payload) when the seat is over no window", async () => {
    const renderer = {
      getPerchProbe: vi.fn(() => ({ seatPx: { x: 40, y: 30 }, charHpx: 200 })),
      isPerched: vi.fn(() => true),
    };
    // window far away from the seat global point → no catch.
    const invoke = vi.fn(async () => [win({ x: 5000, y: 5000 })]);
    const getWindow = () => makeWindow({ x: 0, y: 0 }, 1);
    const { listen, fire } = makeListen();

    const source = createWindowDropSource({ bus, renderer, invoke, getWindow, listen });
    await source.start();
    fire({ point: { x: 0, y: 0 } });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(pushed).toHaveLength(1);
    expect(pushed[0].event_name).toBe("user.window_sit_exit");
    expect(pushed[0].payload).toBeUndefined();
  });

  it("pushes user.window_sit_exit and never calls list_windows when getPerchProbe() is null", async () => {
    const renderer = { getPerchProbe: vi.fn(() => null), isPerched: vi.fn(() => true) };
    const invoke = vi.fn(async () => [win()]);
    const getWindow = () => makeWindow({ x: 0, y: 0 }, 1);
    const { listen, fire } = makeListen();

    const source = createWindowDropSource({ bus, renderer, invoke, getWindow, listen });
    await source.start();
    fire({ point: { x: 0, y: 0 } });
    await Promise.resolve();
    await Promise.resolve();

    expect(invoke).not.toHaveBeenCalled();
    expect(pushed).toHaveLength(1);
    expect(pushed[0].event_name).toBe("user.window_sit_exit");
    expect(pushed[0].payload).toBeUndefined();
  });
});

describe("window-drop-source — side peek drop", () => {
  it.each([
    ["left", 200, 200],
    ["right", 720, 720],
  ] as const)("pushes user.peek_drop with side %s and its resolved local target", async (side, seatX, edgeLocalXpx) => {
    vi.useFakeTimers();
    const peek = { active: true };
    const renderer = {
      getPerchProbe: vi.fn(() => ({ seatPx: { x: seatX, y: 300 }, charHpx: 200 })),
      isPerched: vi.fn(() => false),
    };
    const target = win({ x: 300, y: 100, width: 520, height: 500, windowNumber: 42 });
    const invoke = vi.fn(async () => [target]);
    const { listen, fire } = makeListen();
    const source = createWindowDropSource({
      bus,
      renderer,
      invoke,
      getWindow: () => makeWindow({ x: 200, y: 0 }, 2),
      listen,
      peekActive: () => peek.active,
    });

    await source.start();
    fire({});
    await settleRelease();
    expect(pushed.at(-1)).toMatchObject({
      event_name: "user.peek_drop",
      source: "os_event_watcher",
      hint_tier: 1,
      dnd_override: true,
      payload: {
        side,
        app: "Visual Studio Code",
        window_title: "Other",
        target_local_xpx: side === "left" ? edgeLocalXpx + 24 : edgeLocalXpx - 24,
      },
    });

    invoke.mockImplementation(async () => []);
    await tick();
    expect(pushed.at(-1)?.event_name).toBe("user.peek_exit");
    vi.useRealTimers();
  });

  it("reads configured catch-band fractions for each drop", async () => {
    const peek = {
      side_out_frac: 0.1,
      side_in_frac: 0.1,
      inset_frac: 0.12,
      mirror_side: "right" as const,
    };
    const renderer = {
      getPerchProbe: vi.fn(() => ({ seatPx: { x: 250, y: 300 }, charHpx: 200 })),
      isPerched: vi.fn(() => false),
    };
    const target = win({ x: 300, y: 100, width: 520, height: 500 });
    const { listen, fire } = makeListen();
    const source = createWindowDropSource({
      bus,
      renderer,
      invoke: vi.fn(async () => [target]),
      getWindow: () => makeWindow({ x: 0, y: 0 }, 1),
      listen,
      getPeekConfig: () => peek,
    });

    await source.start();
    fire({});
    await settleRelease();
    expect(pushed.at(-1)?.event_name).toBe("user.window_sit_exit");

    peek.side_out_frac = 0.3;
    fire({});
    await settleRelease();
    expect(pushed.at(-1)).toMatchObject({
      event_name: "user.peek_drop",
      payload: { side: "left", target_local_xpx: 324 },
    });
  });

  it("gives a top-edge candidate precedence over a side-edge candidate", async () => {
    const renderer = {
      getPerchProbe: vi.fn(() => ({ seatPx: { x: 300, y: 300 }, charHpx: 200 })),
      isPerched: vi.fn(() => true),
    };
    const side = win({ x: 320, y: 150, height: 500, windowNumber: 11 });
    const top = win({ x: 100, y: 300, width: 500, windowNumber: 22 });
    const { listen, fire } = makeListen();
    const source = createWindowDropSource({
      bus,
      renderer,
      invoke: vi.fn(async () => [side, top]),
      getWindow: () => makeWindow({ x: 0, y: 0 }, 1),
      listen,
      peekActive: () => true,
    });

    await source.start();
    fire({});
    await settleRelease();
    expect(pushed).toHaveLength(2);
    expect(pushed.find((e) => e.event_name === "user.window_sit_drop")).toBeDefined();
  });

  it("also pushes proactive.peek composing the side-target window name into the cue context", async () => {
    vi.useFakeTimers();
    const peek = { active: true };
    const renderer = {
      getPerchProbe: vi.fn(() => ({ seatPx: { x: 200, y: 300 }, charHpx: 200 })),
      isPerched: vi.fn(() => false),
    };
    const target = win({
      x: 300,
      y: 100,
      width: 520,
      height: 500,
      windowNumber: 42,
      name: "Terminal",
    });
    const invoke = vi.fn(async () => [target]);
    const { listen, fire } = makeListen();
    const source = createWindowDropSource({
      bus,
      renderer,
      invoke,
      getWindow: () => makeWindow({ x: 200, y: 0 }, 2),
      listen,
      peekActive: () => peek.active,
    });

    await source.start();
    fire({});
    await settleRelease();

    const env = pushed.find((e) => e.event_name === "proactive.peek")!;
    expect(env).toBeDefined();
    expect(env.source).toBe("os_event_watcher");
    expect(env.hint_tier).toBe(2);
    expect(env.payload).toEqual({
      cue_id: "peek",
      label: GESTURE_CUES_DEFAULTS.peek.label,
      context: `${GESTURE_CUES_DEFAULTS.peek.context} (currently perched on: Terminal)`,
    });
    vi.useRealTimers();
  });

  it("proactive.peek context has no perch suffix when the side target has no name", async () => {
    vi.useFakeTimers();
    const peek = { active: true };
    const renderer = {
      getPerchProbe: vi.fn(() => ({ seatPx: { x: 200, y: 300 }, charHpx: 200 })),
      isPerched: vi.fn(() => false),
    };
    const target = win({
      x: 300,
      y: 100,
      width: 520,
      height: 500,
      windowNumber: 42,
      name: null,
    });
    const invoke = vi.fn(async () => [target]);
    const { listen, fire } = makeListen();
    const source = createWindowDropSource({
      bus,
      renderer,
      invoke,
      getWindow: () => makeWindow({ x: 200, y: 0 }, 2),
      listen,
      peekActive: () => peek.active,
    });

    await source.start();
    fire({});
    await settleRelease();

    const env = pushed.find((e) => e.event_name === "proactive.peek")!;
    expect(env.payload?.context).toBe(GESTURE_CUES_DEFAULTS.peek.context);
    vi.useRealTimers();
  });

  it("treats a covered side candidate as a miss", async () => {
    const renderer = {
      getPerchProbe: vi.fn(() => ({ seatPx: { x: 300, y: 300 }, charHpx: 200 })),
      isPerched: vi.fn(() => true),
    };
    const cover = win({ x: 0, y: 0, width: 1000, height: 1000, windowNumber: 11 });
    const behind = win({ x: 300, y: 100, height: 500, windowNumber: 22 });
    const { listen, fire } = makeListen();
    const source = createWindowDropSource({
      bus,
      renderer,
      invoke: vi.fn(async () => [cover, behind]),
      getWindow: () => makeWindow({ x: 0, y: 0 }, 1),
      listen,
      peekActive: () => true,
    });

    await source.start();
    fire({});
    await settleRelease();
    expect(pushed).toHaveLength(1);
    expect(pushed[0].event_name).toBe("user.window_sit_exit");
  });
});

describe("window-drop-source — lifecycle + degrade", () => {
  it("start() registers the release listener", async () => {
    const renderer = { getPerchProbe: vi.fn(() => null), isPerched: vi.fn(() => true) };
    const invoke = vi.fn(async () => []);
    const getWindow = () => makeWindow({ x: 0, y: 0 }, 1);
    const { listen } = makeListen();

    const source = createWindowDropSource({ bus, renderer, invoke, getWindow, listen });
    await source.start();
    expect(listen).toHaveBeenCalledWith(RELEASE_EVENT, expect.any(Function));
  });

  it("stop() unlistens the release listener", async () => {
    const renderer = { getPerchProbe: vi.fn(() => null), isPerched: vi.fn(() => true) };
    const invoke = vi.fn(async () => []);
    const getWindow = () => makeWindow({ x: 0, y: 0 }, 1);
    const { listen, unlisten } = makeListen();

    const source = createWindowDropSource({ bus, renderer, invoke, getWindow, listen });
    await source.start();
    source.stop();
    expect(unlisten).toHaveBeenCalled();
  });

  it("does not throw to the caller when invoke('list_windows') rejects", async () => {
    const renderer = {
      getPerchProbe: vi.fn(() => ({ seatPx: { x: 40, y: 30 }, charHpx: 200 })),
      isPerched: vi.fn(() => true),
    };
    const invoke = vi.fn(async () => {
      throw new Error("IPC boom");
    });
    const getWindow = () => makeWindow({ x: 520, y: 740 }, 2);
    const { listen, fire } = makeListen();

    const source = createWindowDropSource({ bus, renderer, invoke, getWindow, listen });
    await source.start();
    expect(() => fire({ point: { x: 0, y: 0 } })).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // degraded: nothing pushed, but no throw.
    expect(pushed).toHaveLength(0);
  });

  it("ignores a malformed release payload without throwing", async () => {
    const renderer = {
      getPerchProbe: vi.fn(() => ({ seatPx: { x: 40, y: 30 }, charHpx: 200 })),
      isPerched: vi.fn(() => true),
    };
    const invoke = vi.fn(async () => [win()]);
    const getWindow = () => makeWindow({ x: 520, y: 740 }, 2);
    const { listen, fire } = makeListen();

    const source = createWindowDropSource({ bus, renderer, invoke, getWindow, listen });
    await source.start();
    expect(() => fire(null)).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    // The release point is unused by the seat-based hit-test, so a malformed
    // payload still drives a probe-based decision — but it must never throw.
  });
});

// ── Occlusion-aware perch detach poll ───────────────────────────────────────
//
// After a successful drop arms the poll, ~1.4 Hz it re-checks whether the
// armed window (tracked by windowNumber) detached: gone from the list, covered
// by an earlier z-order window, or moved more than MOVE_TH from its arm-time
// top-left. Loss fires user.window_sit_exit through the bus and disarms. Geometry seam:
// seatPx (40,30) · pos (520,740) · scale 2 → seatGlobal (300,400), which is the
// top-left corner of the default win() — so the default window contains the seat.

/** A perch probe source whose isPerched() is controllable per tick. */
function makePerchSource(perched = true) {
  const state = { perched };
  return {
    state,
    renderer: {
      getPerchProbe: vi.fn(() => ({ seatPx: { x: 40, y: 30 }, charHpx: 200 })),
      isPerched: vi.fn(() => state.perched),
    },
  };
}

/** Default poll cadence in ms (≈1.4 Hz). */
const DEFAULT_POLL_MS = 700;

/** Advance one poll tick and let all queued microtasks (the await chain) settle. */
async function tick(): Promise<void> {
  await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS);
}

/** Fire a release and flush the onRelease async chain (outerPosition/scaleFactor/invoke + arm). */
async function settleRelease(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe("window-drop-source — peek loss poll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function armPeek() {
    const state = { active: true, probe: true };
    const renderer = {
      getPerchProbe: vi.fn(() =>
        state.probe ? { seatPx: { x: 300, y: 300 }, charHpx: 200 } : null,
      ),
      isPerched: vi.fn(() => false),
    };
    const armed = win({ x: 300, y: 100, width: 520, height: 500, windowNumber: 42 });
    const invoke = vi.fn(async () => [armed]);
    const { listen, fire } = makeListen();
    const source = createWindowDropSource({
      bus,
      renderer,
      invoke,
      getWindow: () => makeWindow({ x: 0, y: 0 }, 1),
      listen,
      peekActive: () => state.active,
    });
    await source.start();
    fire({});
    await settleRelease();
    expect(pushed.at(-1)?.event_name).toBe("user.peek_drop");
    return { source, state, renderer, armed, invoke };
  }

  it("pushes user.peek_exit when the armed window is gone", async () => {
    const { invoke } = await armPeek();
    invoke.mockImplementation(async () => []);
    await tick();
    expect(pushed.filter((e) => e.event_name === "user.peek_exit")).toHaveLength(1);
  });

  it("pushes user.peek_exit after a moved window exceeds the debounce", async () => {
    const { armed, invoke } = await armPeek();
    invoke.mockImplementation(async () => [{ ...armed, x: armed.x + 20 }]);
    await tick();
    expect(pushed.some((e) => e.event_name === "user.peek_exit")).toBe(false);
    await tick();
    expect(pushed.filter((e) => e.event_name === "user.peek_exit")).toHaveLength(1);
  });

  it("still detects peek movement after the renderer probe disappears", async () => {
    const { state, armed, invoke } = await armPeek();
    state.probe = false;
    invoke.mockImplementation(async () => [{ ...armed, y: armed.y + 20 }]);
    await tick();
    await tick();
    expect(pushed.filter((e) => e.event_name === "user.peek_exit")).toHaveLength(1);
  });

  it("does not exit peek when a front window covers the seat", async () => {
    const { armed, invoke } = await armPeek();
    const cover = win({ x: 0, y: 0, width: 1000, height: 1000, windowNumber: 99 });
    invoke.mockImplementation(async () => [cover, armed]);
    await tick();
    await tick();
    await tick();
    expect(pushed.some((e) => e.event_name === "user.peek_exit")).toBe(false);
  });

  it("silently disarms when peek intent is inactive", async () => {
    const { state, invoke } = await armPeek();
    state.active = false;
    invoke.mockImplementation(async () => []);
    await tick();
    await tick();
    expect(pushed.some((e) => e.event_name === "user.peek_exit")).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("disarm invalidates an in-flight tick so it cannot emit a second exit", async () => {
    let tickCb: (() => void) | null = null;
    const fakeSetInterval = ((cb: () => void) => {
      tickCb = cb;
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval;
    const fakeClearInterval = (() => {
      tickCb = null;
    }) as typeof clearInterval;
    const renderer = {
      getPerchProbe: vi.fn(() => ({ seatPx: { x: 300, y: 300 }, charHpx: 200 })),
      isPerched: vi.fn(() => false),
    };
    const armed = win({ x: 300, y: 100, height: 500, windowNumber: 42 });
    const far = win({ x: 5000, y: 5000, windowNumber: 77 });
    let resolveTick!: (windows: WindowRect[]) => void;
    const pendingTick = new Promise<WindowRect[]>((resolve) => (resolveTick = resolve));
    let call = 0;
    const invoke = vi.fn(async () => {
      call++;
      if (call === 1) return [armed];
      if (call === 2) return pendingTick;
      return [far];
    });
    const { listen, fire } = makeListen();
    const source = createWindowDropSource({
      bus,
      renderer,
      invoke,
      getWindow: () => makeWindow({ x: 0, y: 0 }, 1),
      listen,
      peekActive: () => true,
      setInterval: fakeSetInterval,
      clearInterval: fakeClearInterval,
    });
    await source.start();
    fire({});
    await settleRelease();

    (tickCb as (() => void) | null)?.();
    await Promise.resolve();
    await Promise.resolve();
    fire({});
    await settleRelease();
    expect(pushed.filter((e) => e.event_name.endsWith("_exit"))).toHaveLength(1);

    resolveTick([]);
    await settleRelease();
    expect(pushed.filter((e) => e.event_name.endsWith("_exit"))).toHaveLength(1);
  });
});

describe("window-drop-source — occlusion poll arm/hold (J1)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("arms the poll on a successful drop", async () => {
    const { renderer } = makePerchSource();
    const armed = win({ name: "Armed", windowNumber: 42 });
    const invoke = vi.fn(async () => [armed]);
    const getWindow = () => makeWindow({ x: 520, y: 740 }, 2);
    const { listen, fire } = makeListen();
    const source = createWindowDropSource({ bus, renderer, invoke, getWindow, listen });

    await source.start();
    fire({ point: { x: 0, y: 0 } });
    await settleRelease();
    expect(pushed.at(-1)?.event_name).toBe("user.window_sit_drop");

    // poll now armed: a tick with the unchanged list HOLDS (no exit).
    await tick();
    expect(pushed.some((e) => e.event_name === "user.window_sit_exit")).toBe(false);
  });

  it("a tick immediately after the drop with an unchanged list HOLDS (no self-detach)", async () => {
    const { renderer } = makePerchSource();
    const armed = win({ name: "Armed", windowNumber: 42 });
    const invoke = vi.fn(async () => [armed]);
    const getWindow = () => makeWindow({ x: 520, y: 740 }, 2);
    const { listen, fire } = makeListen();
    const source = createWindowDropSource({ bus, renderer, invoke, getWindow, listen });

    await source.start();
    fire({ point: { x: 0, y: 0 } });
    await settleRelease();

    await tick();
    await tick();
    await tick();
    expect(pushed.filter((e) => e.event_name === "user.window_sit_exit")).toHaveLength(0);
  });
});

describe("window-drop-source — occlusion poll default cadence (J1b)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires the default poll tick at ~700ms (≈1.4 Hz) when pollIntervalMs is not injected", async () => {
    const { renderer } = makePerchSource();
    const armed = win({ name: "Armed", windowNumber: 42 });
    const invoke = vi.fn(async () => [armed]);
    const getWindow = () => makeWindow({ x: 520, y: 740 }, 2);
    const { listen, fire } = makeListen();
    // No pollIntervalMs → exercises DEFAULT_POLL_MS.
    const source = createWindowDropSource({ bus, renderer, invoke, getWindow, listen });

    await source.start();
    fire({ point: { x: 0, y: 0 } });
    await settleRelease();
    expect(pushed.at(-1)?.event_name).toBe("user.window_sit_drop");

    // Window now absent → an unambiguous loss fires exit on the first tick.
    invoke.mockImplementation(async () => []);

    // Just shy of the cadence: no tick yet.
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS - 1);
    expect(pushed.some((e) => e.event_name === "user.window_sit_exit")).toBe(false);

    // Crossing 700ms total fires the tick → exit.
    await vi.advanceTimersByTimeAsync(1);
    expect(pushed.filter((e) => e.event_name === "user.window_sit_exit")).toHaveLength(1);
  });
});

describe("window-drop-source — occlusion poll loss + debounce (J2)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function armOn(_armed: WindowRect, lists: WindowRect[][]) {
    const { renderer } = makePerchSource();
    const invoke = vi.fn(async () => lists[0]);
    const getWindow = () => makeWindow({ x: 520, y: 740 }, 2);
    const { listen, fire } = makeListen();
    const source = createWindowDropSource({ bus, renderer, invoke, getWindow, listen });
    await source.start();
    invoke.mockImplementation(async () => lists[0]);
    fire({ point: { x: 0, y: 0 } });
    await settleRelease();
    return { invoke, lists };
  }

  it("a window above that covers the seat detaches after 2 ticks (ambiguous loss)", async () => {
    const armed = win({ name: "Armed", windowNumber: 42 });
    const cover = win({ name: "Cover", windowNumber: 99 }); // same rect → contains seat (300,400)
    const { invoke } = await armOn(armed, [[armed]]);

    invoke.mockImplementation(async () => [cover, armed]); // cover is ABOVE armed.
    await tick(); // lostStreak = 1 → no exit yet.
    expect(pushed.some((e) => e.event_name === "user.window_sit_exit")).toBe(false);
    await tick(); // lostStreak = 2 → detach.
    expect(pushed.filter((e) => e.event_name === "user.window_sit_exit")).toHaveLength(1);
  });

  it("the armed window absent/closed detaches on the FIRST tick (unambiguous loss)", async () => {
    const armed = win({ name: "Armed", windowNumber: 42 });
    const stranger = win({ name: "Stranger", windowNumber: 7 });
    const { invoke } = await armOn(armed, [[armed]]);

    invoke.mockImplementation(async () => [stranger]); // armed (42) is gone.
    await tick();
    expect(pushed.filter((e) => e.event_name === "user.window_sit_exit")).toHaveLength(1);
  });

  it("a window whose top edge is only in the U-band above the armed window does NOT detach (S1)", async () => {
    const armed = win({ name: "Armed", windowNumber: 42 });
    // A window above whose top is within the catch U-band (0.28*200=56px above
    // seat.y 400 → y≥344) but which does NOT cover the seat point: its bottom
    // edge sits above the seat (does not contain (300,400)).
    const grazing = win({
      name: "Grazing",
      windowNumber: 99,
      x: 300,
      y: 360,
      width: 520,
      height: 20,
    });
    const { invoke } = await armOn(armed, [[armed]]);

    invoke.mockImplementation(async () => [grazing, armed]);
    await tick();
    await tick();
    await tick();
    expect(pushed.some((e) => e.event_name === "user.window_sit_exit")).toBe(false);
  });

  it("a single covered tick followed by an uncovered tick does NOT detach (debounce ride-out)", async () => {
    const armed = win({ name: "Armed", windowNumber: 42 });
    const cover = win({ name: "Cover", windowNumber: 99 });
    const { invoke } = await armOn(armed, [[armed]]);

    invoke.mockImplementation(async () => [cover, armed]); // covered.
    await tick(); // lostStreak = 1.
    invoke.mockImplementation(async () => [armed]); // uncovered again.
    await tick(); // held → streak reset.
    invoke.mockImplementation(async () => [cover, armed]); // covered again.
    await tick(); // lostStreak = 1 (reset earlier) → still no exit.
    expect(pushed.some((e) => e.event_name === "user.window_sit_exit")).toBe(false);
  });
});

describe("window-drop-source — occlusion poll lifecycle + races (J3)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("disarms on a miss (own exit) — no further ticks fire exit", async () => {
    const { renderer } = makePerchSource();
    // seat over no window → onRelease pushes exit, never arms.
    const invoke = vi.fn(async () => [win({ x: 5000, y: 5000 })]);
    const getWindow = () => makeWindow({ x: 520, y: 740 }, 2);
    const { listen, fire } = makeListen();
    const source = createWindowDropSource({ bus, renderer, invoke, getWindow, listen });
    await source.start();
    fire({ point: { x: 0, y: 0 } });
    await settleRelease();
    expect(pushed.filter((e) => e.event_name === "user.window_sit_exit")).toHaveLength(1);

    invoke.mockImplementation(async () => [win({ windowNumber: 12345 })]);
    await tick();
    await tick();
    // not armed → poll does nothing.
    expect(pushed.filter((e) => e.event_name === "user.window_sit_exit")).toHaveLength(1);
  });

  it("a fresh drop re-arms with the new windowNumber", async () => {
    const { renderer } = makePerchSource();
    const winA = win({ name: "A", windowNumber: 1 });
    const winB = win({ name: "B", windowNumber: 2 });
    const invoke = vi.fn(async () => [winA]);
    const getWindow = () => makeWindow({ x: 520, y: 740 }, 2);
    const { listen, fire } = makeListen();
    const source = createWindowDropSource({ bus, renderer, invoke, getWindow, listen });
    await source.start();

    invoke.mockImplementation(async () => [winA]);
    fire({ point: { x: 0, y: 0 } });
    await settleRelease(); // armed on 1.

    invoke.mockImplementation(async () => [winB]); // re-drop onto B.
    fire({ point: { x: 0, y: 0 } });
    await settleRelease(); // re-armed on 2.

    // Only B present now → armed on 2 holds; remove 2 to prove the new arm is live.
    invoke.mockImplementation(async () => [winA]); // 2 gone, only 1 left → lost.
    await tick();
    expect(pushed.filter((e) => e.event_name === "user.window_sit_exit")).toHaveLength(1);
  });

  it("a tick where isPerched()===false disarms silently (no exit pushed)", async () => {
    const probe = makePerchSource();
    const armed = win({ name: "Armed", windowNumber: 42 });
    const invoke = vi.fn(async () => [armed]);
    const getWindow = () => makeWindow({ x: 520, y: 740 }, 2);
    const { listen, fire } = makeListen();
    const source = createWindowDropSource({
      bus,
      renderer: probe.renderer,
      invoke,
      getWindow,
      listen,
    });
    await source.start();
    fire({ point: { x: 0, y: 0 } });
    await settleRelease();

    // perch ended elsewhere (manual re-grab / dev exit).
    probe.state.perched = false;
    // make the list "lost" too, to prove the silent disarm wins over a loss.
    invoke.mockImplementation(async () => []);
    await tick();
    await tick();
    expect(pushed.some((e) => e.event_name === "user.window_sit_exit")).toBe(false);
  });

  it("an in-flight re-arm discards the stale tick result (S3 pollGen)", async () => {
    // Drive the poll tick manually via a captured-callback interval so the await
    // boundary is deterministic: start a tick (gen 1, list_windows blocked), let a
    // fresh drop re-arm (gen 2) mid-await, then resolve the stale list as EMPTY.
    // For the re-armed window 77 an empty list reads as an unambiguous loss and
    // would detach on the FIRST tick — the pollGen guard must discard it instead.
    let tickCb: (() => void) | null = null;
    const fakeSetInterval = ((cb: () => void) => {
      tickCb = cb;
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval;
    const fakeClearInterval = (() => {
      tickCb = null;
    }) as typeof clearInterval;

    const probe = makePerchSource();
    const armed = win({ name: "Armed", windowNumber: 42 });
    const fresh = win({ name: "Fresh", windowNumber: 77 });
    const getWindow = () => makeWindow({ x: 520, y: 740 }, 2);
    const { listen, fire } = makeListen();

    let releaseTickList!: (v: WindowRect[]) => void;
    const tickPending = new Promise<WindowRect[]>((res) => (releaseTickList = res));
    let call = 0;
    const invoke = vi.fn(async () => {
      call++;
      if (call === 1) return [armed]; // drop #1 → arm 42.
      if (call === 2) return tickPending; // poll tick (gen 1) → blocks on the await.
      return [fresh]; // drop #2 (arm 77) + any later tick.
    });

    const source = createWindowDropSource({
      bus,
      renderer: probe.renderer,
      invoke,
      getWindow,
      listen,
      setInterval: fakeSetInterval,
      clearInterval: fakeClearInterval,
    });
    await source.start();

    fire({ point: { x: 0, y: 0 } });
    await settleRelease(); // armed on 42, gen = 1, tickCb captured.

    // Fire one poll tick — it reaches the blocked list_windows (call #2) and awaits.
    // ponytail: cast — TS CFA narrows the closure-assigned `let` to null here.
    const tickRun = (async () => (tickCb as (() => void) | null)?.())();
    await Promise.resolve();
    await Promise.resolve();

    // A fresh drop arrives mid-await → re-arms on 77, bumping pollGen to 2.
    fire({ point: { x: 0, y: 0 } });
    await settleRelease(); // re-armed on 77, gen = 2.

    // Resolve the STALE (gen-1) list as EMPTY → would detach the live 77, but the
    // captured gen (1) ≠ live gen (2) must discard the result.
    releaseTickList([]);
    await tickRun;
    await settleRelease();

    expect(pushed.some((e) => e.event_name === "user.window_sit_exit")).toBe(false);
  });

  it("detaches cleanly when the window vanishes between getPerchProbe and invoke", async () => {
    const probe = makePerchSource();
    const armed = win({ name: "Armed", windowNumber: 42 });
    const invoke = vi.fn(async () => [armed]);
    const getWindow = () => makeWindow({ x: 520, y: 740 }, 2);
    const { listen, fire } = makeListen();
    const source = createWindowDropSource({
      bus,
      renderer: probe.renderer,
      invoke,
      getWindow,
      listen,
    });
    await source.start();
    fire({ point: { x: 0, y: 0 } });
    await settleRelease();

    // probe still ok, but the armed window is absent from the fresh list → first-tick detach.
    invoke.mockImplementation(async () => []);
    await tick();
    expect(pushed.filter((e) => e.event_name === "user.window_sit_exit")).toHaveLength(1);
  });

  it("a mid-drag tick fires exit at most once and does not double-fire against the release", async () => {
    const probe = makePerchSource();
    const armed = win({ name: "Armed", windowNumber: 42 });
    const invoke = vi.fn(async () => [armed]);
    const getWindow = () => makeWindow({ x: 520, y: 740 }, 2);
    const { listen, fire } = makeListen();
    const source = createWindowDropSource({
      bus,
      renderer: probe.renderer,
      invoke,
      getWindow,
      listen,
    });
    await source.start();
    fire({ point: { x: 0, y: 0 } });
    await settleRelease();

    // Mid-drag: perch still true on screen but the armed window has gone (re-grab) →
    // first-tick unambiguous detach (one exit).
    invoke.mockImplementation(async () => []);
    await tick();
    // The release then resolves over no window → onRelease pushes its own exit, but the
    // poll already disarmed, so no poll double-fire.
    invoke.mockImplementation(async () => [win({ x: 5000, y: 5000, windowNumber: 1 })]);
    fire({ point: { x: 0, y: 0 } });
    await settleRelease();

    // Exactly: one poll exit + one release exit = 2, never a poll double-fire on later ticks.
    const before = pushed.filter((e) => e.event_name === "user.window_sit_exit").length;
    await tick();
    await tick();
    const after = pushed.filter((e) => e.event_name === "user.window_sit_exit").length;
    expect(after).toBe(before); // disarmed → no further poll exits.
  });

  it("stop() halts the poll — no exit after disposal", async () => {
    const probe = makePerchSource();
    const armed = win({ name: "Armed", windowNumber: 42 });
    const invoke = vi.fn(async () => [armed]);
    const getWindow = () => makeWindow({ x: 520, y: 740 }, 2);
    const { listen, fire } = makeListen();
    const source = createWindowDropSource({
      bus,
      renderer: probe.renderer,
      invoke,
      getWindow,
      listen,
    });
    await source.start();
    fire({ point: { x: 0, y: 0 } });
    await settleRelease();

    source.stop();
    invoke.mockImplementation(async () => []); // would be lost if polled.
    await tick();
    await tick();
    expect(pushed.some((e) => e.event_name === "user.window_sit_exit")).toBe(false);
  });
});

// ── Arm-baseline delta hold test (perch false-detach) ───────────────────────
//
// The held-perch test is "did the armed window MOVE from its arm-time position",
// not "is the seat still inside the window". A seat parked a few px above the
// window's top edge (animation bob + the drop/hold catch-zone asymmetry) yields
// zero window displacement → no false detach. Genuine window moves and occlusion
// still detach.

describe("window-drop-source — arm-baseline detach policy (#191)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Arm with a window whose top edge sits BELOW the seat (seat parked above the edge). */
  async function armAbove() {
    const probe = makePerchSource();
    // Seat lands at (300, 400); armed top y=412 sits 12px below it, so the seat
    // is parked above the edge.
    const armed = win({ name: "Armed", windowNumber: 42, y: 412 });
    const invoke = vi.fn(async () => [armed]);
    const getWindow = () => makeWindow({ x: 520, y: 740 }, 2);
    const { listen, fire } = makeListen();
    const source = createWindowDropSource({
      bus,
      renderer: probe.renderer,
      invoke,
      getWindow,
      listen,
    });
    await source.start();
    fire({ point: { x: 0, y: 0 } });
    await settleRelease();
    expect(pushed.at(-1)?.event_name).toBe("user.window_sit_drop");
    return { source, invoke, armed };
  }

  it("a seat parked above the armed window's top edge HOLDS across many ticks (#191 regression)", async () => {
    const probe = makePerchSource();
    // seat parked above the edge: catch zone allows up to 0.28*200=56px above.
    // armed top y=412, seat.y=400 → seat 12px ABOVE the edge, still in the U-band.
    const armed = win({ name: "Armed", windowNumber: 42, y: 412 });
    const invoke = vi.fn(async () => [armed]);
    const getWindow = () => makeWindow({ x: 520, y: 740 }, 2);
    const { listen, fire } = makeListen();
    const source = createWindowDropSource({
      bus,
      renderer: probe.renderer,
      invoke,
      getWindow,
      listen,
    });
    await source.start();
    fire({ point: { x: 0, y: 0 } });
    await settleRelease();
    expect(pushed.at(-1)?.event_name).toBe("user.window_sit_drop");

    // Armed rect UNCHANGED across many ticks → no displacement → no detach,
    // even though the seat sits strictly above the window's top edge.
    for (let i = 0; i < 8; i++) await tick();
    expect(pushed.some((e) => e.event_name === "user.window_sit_exit")).toBe(false);
  });

  it("the armed window moving more than MOVE_TH detaches after 2 ticks (moved)", async () => {
    const { invoke, armed } = await armAbove();

    // Window slides down 40px (> MOVE_TH=12) from its arm-time y=412.
    invoke.mockImplementation(async () => [{ ...armed, y: armed.y + 40 }]);
    await tick(); // lostStreak = 1 → ambiguous, no exit yet.
    expect(pushed.some((e) => e.event_name === "user.window_sit_exit")).toBe(false);
    await tick(); // lostStreak = 2 → detach.
    expect(pushed.filter((e) => e.event_name === "user.window_sit_exit")).toHaveLength(1);
  });

  it("a window above that covers the seat detaches after 2 ticks (covered)", async () => {
    const { invoke, armed } = await armAbove();
    // A window earlier in z-order whose rect contains the live seat (300,400).
    const cover = win({ name: "Cover", windowNumber: 99, y: 360, height: 200 });

    invoke.mockImplementation(async () => [cover, armed]); // cover is ABOVE armed.
    await tick(); // lostStreak = 1 → no exit yet.
    expect(pushed.some((e) => e.event_name === "user.window_sit_exit")).toBe(false);
    await tick(); // lostStreak = 2 → detach.
    expect(pushed.filter((e) => e.event_name === "user.window_sit_exit")).toHaveLength(1);
  });

  it("the armed window absent from list_windows detaches on the FIRST tick (gone)", async () => {
    const { invoke } = await armAbove();

    invoke.mockImplementation(async () => [win({ name: "Stranger", windowNumber: 7 })]);
    await tick();
    expect(pushed.filter((e) => e.event_name === "user.window_sit_exit")).toHaveLength(1);
  });

  it("the armed window jittering less than MOVE_TH HOLDS (jitter tolerated)", async () => {
    const { invoke, armed } = await armAbove();

    // Sub-threshold jitter on both axes (< MOVE_TH=12) → treated as noise.
    invoke.mockImplementation(async () => [{ ...armed, x: armed.x + 8, y: armed.y - 9 }]);
    for (let i = 0; i < 6; i++) await tick();
    expect(pushed.some((e) => e.event_name === "user.window_sit_exit")).toBe(false);
  });
});

describe("window-drop-source — programmatic placement (agent-driven gestures)", () => {
  /**
   * Same geometry as the perch-hit fixture (seat at global (300, 400)), plus the
   * position setter the programmatic path needs.
   */
  function makePlaceWindow(pos = { x: 520, y: 740 }, scale = 2) {
    const setPositionPhysical = vi.fn(async () => {});
    return {
      window: {
        outerPosition: vi.fn(async () => pos),
        scaleFactor: vi.fn(async () => scale),
        setPositionPhysical,
      },
      setPositionPhysical,
    };
  }

  function makeDeps(windows: WindowRect[], pet = makePlaceWindow()) {
    const renderer = {
      getPerchProbe: vi.fn(() => ({ seatPx: { x: 40, y: 30 }, charHpx: 200 })),
      isPerched: vi.fn(() => true),
    };
    const invoke = vi.fn(async () => windows);
    const { listen } = makeListen();
    return { bus, renderer, invoke, getWindow: () => pet.window, listen };
  }

  it("moves the pet window so the seat lands on the named window's top edge", async () => {
    const pet = makePlaceWindow();
    const source = createWindowDropSource(makeDeps([win({ ownerName: "Notes" })], pet));

    const result = await source.placeOn({ kind: "sit", app: "Notes" });

    // Desired seat = top-edge center (560, 400); seat is at (300, 400) → delta (260, 0) points.
    // New physical origin = (520 + 260*2, 740 + 0).
    expect(pet.setPositionPhysical).toHaveBeenCalledWith(1040, 740);
    expect(result).toEqual({ ok: true, kind: "sit" });
  });

  it("pushes the same tier1 perch envelope the drag flow pushes, against the new position", async () => {
    const source = createWindowDropSource(makeDeps([win({ ownerName: "Notes", name: "Todo" })]));

    await source.placeOn({ kind: "sit", app: "Notes" });

    expect(pushed.map((e) => e.event_name)).toEqual(["user.window_sit_drop"]);
    const env = pushed[0];
    expect(env.source).toBe("os_event_watcher");
    expect(env.hint_tier).toBe(1);
    expect(env.dnd_override).toBe(true);
    expect(env.payload?.app).toBe("Notes");
    expect(env.payload?.window_title).toBe("Todo");
    // edge_local_ypx = target.y - newPos.y/scale = 400 - 740/2 = 30.
    expect(env.payload?.edge_local_ypx).toBeCloseTo(30, 6);
  });

  it("arms the occlusion poll exactly as the drag flow does", async () => {
    const source = createWindowDropSource(makeDeps([win({ ownerName: "Notes" })]));

    await source.placeOn({ kind: "sit", app: "Notes" });
    pushed.length = 0;
    source.release();

    // A sit-armed source releases through the sit exit; an unarmed one would too,
    // so pair this with the peek case below where the armed kind is observable.
    expect(pushed.map((e) => e.event_name)).toEqual(["user.window_sit_exit"]);
  });

  it("places a peek on the requested side edge and arms the peek", async () => {
    const pet = makePlaceWindow();
    const source = createWindowDropSource(makeDeps([win({ ownerName: "Notes" })], pet));

    const result = await source.placeOn({ kind: "peek", side: "left" });

    // Desired seat = left edge mid-height (300, 560); delta (0, 160) points.
    expect(pet.setPositionPhysical).toHaveBeenCalledWith(520, 1060);
    expect(result).toEqual({ ok: true, kind: "peek" });
    const env = pushed.find((e) => e.event_name === "user.peek_drop")!;
    expect(env.payload?.side).toBe("left");
    // edgeLocalXpx = 300 - 520/2 = 40; inset = 0.12 * 200 = 24 → 64.
    expect(env.payload?.target_local_xpx).toBeCloseTo(64, 6);
    pushed.length = 0;
    source.release();
    expect(pushed.map((e) => e.event_name)).toEqual(["user.peek_exit"]);
  });

  it("suppresses the proactive cue for both gestures", async () => {
    const sit = createWindowDropSource(makeDeps([win({ ownerName: "Notes" })]));
    await sit.placeOn({ kind: "sit", app: "Notes" });
    expect(pushed.some((e) => e.event_name.startsWith("proactive."))).toBe(false);

    pushed.length = 0;
    const peek = createWindowDropSource(makeDeps([win({ ownerName: "Notes" })]));
    await peek.placeOn({ kind: "peek", side: "right" });
    expect(pushed.some((e) => e.event_name.startsWith("proactive."))).toBe(false);
  });

  it("reports blocked without moving when a window in front covers the seat point", async () => {
    // Cover sits above the target and contains the desired seat point (560, 400).
    const cover = win({
      ownerName: "Finder",
      name: "Cover",
      windowNumber: 99,
      x: 500,
      y: 350,
      width: 300,
      height: 200,
    });
    const pet = makePlaceWindow();
    const source = createWindowDropSource(makeDeps([cover, win({ ownerName: "Notes" })], pet));

    const result = await source.placeOn({ kind: "sit", app: "Notes" });

    expect(result).toEqual({ ok: false, reason: "blocked" });
    expect(pet.setPositionPhysical).not.toHaveBeenCalled();
    expect(pushed).toHaveLength(0);
  });

  it("reports not_found without moving when no window carries the app name", async () => {
    const pet = makePlaceWindow();
    const source = createWindowDropSource(makeDeps([win({ ownerName: "Notes" })], pet));

    const result = await source.placeOn({ kind: "sit", app: "Xcode" });

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(pet.setPositionPhysical).not.toHaveBeenCalled();
    expect(pushed).toHaveLength(0);
  });

  it("takes the frontmost window carrying the app name (front-to-back order)", async () => {
    const front = win({ ownerName: "Notes", name: "Front", windowNumber: 1, y: 400 });
    const back = win({ ownerName: "Notes", name: "Back", windowNumber: 2, y: 440 });
    const source = createWindowDropSource(makeDeps([front, back]));

    await source.placeOn({ kind: "sit", app: "Notes" });

    expect(pushed[0].payload?.window_title).toBe("Front");
  });

  it("peeks around the frontmost window", async () => {
    const front = win({ ownerName: "Notes", name: "Front", windowNumber: 1 });
    const back = win({ ownerName: "Safari", name: "Back", windowNumber: 2 });
    const source = createWindowDropSource(makeDeps([front, back]));

    await source.placeOn({ kind: "peek", side: "right" });

    const env = pushed.find((e) => e.event_name === "user.peek_drop")!;
    expect(env.payload?.window_title).toBe("Front");
  });

  it("reports not_found for a peek when no window is on screen", async () => {
    const source = createWindowDropSource(makeDeps([]));

    expect(await source.placeOn({ kind: "peek", side: "left" })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("reports unsupported when there is no perch probe", async () => {
    const deps = makeDeps([win({ ownerName: "Notes" })]);
    deps.renderer.getPerchProbe = vi.fn(() => null);
    const source = createWindowDropSource(deps);

    expect(await source.placeOn({ kind: "sit", app: "Notes" })).toEqual({
      ok: false,
      reason: "unsupported",
    });
  });

  it("commits against where the window actually landed, not where it was asked to go", async () => {
    // The window manager clamps the move (menu bar / screen bounds).
    let pos = { x: 520, y: 740 };
    const setPositionPhysical = vi.fn(async (x: number, y: number) => {
      pos = { x, y: Math.min(y, 700) };
    });
    const pet = {
      window: {
        outerPosition: vi.fn(async () => pos),
        scaleFactor: vi.fn(async () => 2),
        setPositionPhysical,
      },
      setPositionPhysical,
    };
    const source = createWindowDropSource(makeDeps([win({ ownerName: "Notes" })], pet));

    await source.placeOn({ kind: "sit", app: "Notes" });

    expect(setPositionPhysical).toHaveBeenCalledWith(1040, 740);
    // Clamped to y=700 → edge_local_ypx = 400 - 700/2 = 50, not the requested 30.
    const env = pushed.find((e) => e.event_name === "user.window_sit_drop")!;
    expect(env.payload?.edge_local_ypx).toBeCloseTo(50, 6);
  });

  it("aborts before pushing or arming when the caller signals mid-place", async () => {
    const pet = makePlaceWindow();
    const source = createWindowDropSource(makeDeps([win({ ownerName: "Notes" })], pet));

    const result = await source.placeOn({ kind: "sit", app: "Notes" }, { shouldAbort: () => true });

    expect(result).toEqual({ ok: false, reason: "interrupted" });
    // The move already happened, but no envelope and no arming followed it.
    expect(pet.setPositionPhysical).toHaveBeenCalled();
    expect(pushed).toHaveLength(0);
    pushed.length = 0;
    source.release();
    expect(pushed.map((e) => e.event_name)).toEqual(["user.window_sit_exit"]);
  });

  it("reports unsupported when the window cannot be moved", async () => {
    const source = createWindowDropSource({
      ...makeDeps([win({ ownerName: "Notes" })]),
      getWindow: () => makeWindow({ x: 520, y: 740 }, 2),
    });

    expect(await source.placeOn({ kind: "sit", app: "Notes" })).toEqual({
      ok: false,
      reason: "unsupported",
    });
  });
});

describe("window-drop-source — perch targets + release", () => {
  it("exposes the tracked candidate windows and the peek edges", async () => {
    const renderer = {
      getPerchProbe: vi.fn(() => ({ seatPx: { x: 40, y: 30 }, charHpx: 200 })),
      isPerched: vi.fn(() => true),
    };
    const invoke = vi.fn(async () => [win({ name: "Notes", ownerName: "Notes" })]);
    const getWindow = () => makeWindow({ x: 520, y: 740 }, 2);
    const { listen } = makeListen();

    const source = createWindowDropSource({ bus, renderer, invoke, getWindow, listen });
    const targets = await source.perchTargets();

    expect(invoke).toHaveBeenCalledWith("list_windows");
    expect(targets).toEqual({
      windows: [
        {
          app: "Notes",
          title: "Notes",
          rect: { x: 300, y: 400, width: 520, height: 320 },
        },
      ],
      edges: ["left", "right"],
    });
  });

  it("release pushes the sit exit when nothing is armed", () => {
    const renderer = {
      getPerchProbe: vi.fn(() => null),
      isPerched: vi.fn(() => false),
    };
    const invoke = vi.fn(async () => []);
    const getWindow = () => makeWindow({ x: 0, y: 0 }, 1);
    const { listen } = makeListen();

    const source = createWindowDropSource({ bus, renderer, invoke, getWindow, listen });
    source.release();

    expect(pushed.map((e) => e.event_name)).toEqual(["user.window_sit_exit"]);
  });
});
