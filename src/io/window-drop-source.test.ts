/**
 * window-drop-source.test.ts — TDD red phase.
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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createWindowDropSource } from "./window-drop-source";
import type { EventBus, BusEnvelope } from "../dispatcher/event-bus";
import type { WindowRect } from "../contract";

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
    expect(pushed).toHaveLength(1);
    const env = pushed[0];
    expect(env.event_name).toBe("user.window_sit_drop");
    expect(env.source).toBe("os_event_watcher");
    expect(env.hint_tier).toBe(1);
    expect(env.dnd_override).toBe(true);
    expect(env.payload?.target_window_rect).toEqual(W);
    // edge_local_ypx = W.y - pos.y/scale = 400 - 740/2 = 400 - 370 = 30.
    expect(env.payload?.edge_local_ypx).toBeCloseTo(30, 6);
  });

  it("chooses the topmost (first front-to-back) window when several overlap the seat", async () => {
    const renderer = {
      getPerchProbe: vi.fn(() => ({ seatPx: { x: 40, y: 30 }, charHpx: 200 })),
    };
    const top = win({ name: "Top", pid: 1 });
    const back = win({ name: "Back", pid: 2 });
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

    expect(pushed).toHaveLength(1);
    expect(pushed[0].payload?.target_window_rect).toEqual(top);
  });
});

describe("window-drop-source — no perch", () => {
  it("pushes user.window_sit_exit (no payload) when the seat is over no window", async () => {
    const renderer = {
      getPerchProbe: vi.fn(() => ({ seatPx: { x: 40, y: 30 }, charHpx: 200 })),
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
    const renderer = { getPerchProbe: vi.fn(() => null) };
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

describe("window-drop-source — lifecycle + degrade", () => {
  it("start() registers the release listener", async () => {
    const renderer = { getPerchProbe: vi.fn(() => null) };
    const invoke = vi.fn(async () => []);
    const getWindow = () => makeWindow({ x: 0, y: 0 }, 1);
    const { listen } = makeListen();

    const source = createWindowDropSource({ bus, renderer, invoke, getWindow, listen });
    await source.start();
    expect(listen).toHaveBeenCalledWith(RELEASE_EVENT, expect.any(Function));
  });

  it("stop() unlistens the release listener", async () => {
    const renderer = { getPerchProbe: vi.fn(() => null) };
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

// ── Occlusion-aware perch detach poll (#143) ────────────────────────────────
//
// After a successful drop arms the poll, ~1.3 Hz it re-checks whether the
// perched window (tracked by windowNumber) still sits under the seat and is
// topmost. The held-perch test is point-in-rect (NOT the U-band catch zone).
// Loss fires user.window_sit_exit through the bus and disarms. Geometry seam:
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

/** Advance one poll tick and let all queued microtasks (the await chain) settle. */
async function tick(): Promise<void> {
  await vi.advanceTimersByTimeAsync(1500);
}

/** Fire a release and flush the onRelease async chain. */
async function settleRelease(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

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

describe("window-drop-source — occlusion poll loss + debounce (J2)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function armOn(armed: WindowRect, lists: WindowRect[][]) {
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
    const grazing = win({ name: "Grazing", windowNumber: 99, x: 300, y: 360, width: 520, height: 20 });
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
    const probe = makePerchSource();
    const armed = win({ name: "Armed", windowNumber: 42 });
    const fresh = win({ name: "Fresh", windowNumber: 77 });
    const getWindow = () => makeWindow({ x: 520, y: 740 }, 2);
    const { listen, fire } = makeListen();

    // The first poll invoke blocks until we release it; meanwhile a fresh drop re-arms.
    let releaseStaleList!: (v: WindowRect[]) => void;
    const stalePending = new Promise<WindowRect[]>((res) => (releaseStaleList = res));
    let firstListCall = true;
    const invoke = vi.fn(async () => {
      if (firstListCall) {
        firstListCall = false;
        return stalePending; // tick’s await hangs here.
      }
      return [fresh]; // re-drop + subsequent ticks see fresh.
    });

    const source = createWindowDropSource({
      bus,
      renderer: probe.renderer,
      invoke,
      getWindow,
      listen,
    });
    await source.start();

    // First drop arms on 42 (uses the blocking invoke for its own list — release it).
    fire({ point: { x: 0, y: 0 } });
    // onRelease awaits the same blocking invoke; release with armed present so it arms.
    releaseStaleList([armed]);
    await settleRelease();

    // Re-arm the blocking gate for the next list call (the poll tick).
    firstListCall = true;
    const stale2 = new Promise<WindowRect[]>((res) => (releaseStaleList = res));
    invoke.mockImplementation(async () => {
      if (firstListCall) {
        firstListCall = false;
        return stale2;
      }
      return [fresh];
    });

    // Start a poll tick — it awaits the blocking list.
    const pending = vi.advanceTimersByTimeAsync(1500);
    await Promise.resolve();

    // A fresh drop arrives mid-await → re-arms on 77, bumping pollGen.
    fire({ point: { x: 0, y: 0 } });
    await settleRelease();

    // Now release the STALE list as "armed (42) absent" — would normally detach,
    // but pollGen mismatch must discard it.
    releaseStaleList([fresh]);
    await pending;

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
