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

import { describe, it, expect, vi, beforeEach } from "vitest";
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
