/**
 * perch-watch.test.ts — the armed perch state and its occlusion-aware detach poll,
 * driven directly through its interface. Drop-driven poll cases live in
 * window-drop-source.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BusEnvelope, EventBus } from "../../core/event-bus";
import { createPerchWatch } from "./perch-watch";
import { makeBus, makePerchSource, makeWindow, tick, win } from "./test-helpers";

let bus: EventBus;
let pushed: BusEnvelope[];

beforeEach(() => {
  ({ bus, pushed } = makeBus());
});

describe("perch-watch — adopted sit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function adopted(origin: "commit" | "adopt" = "adopt") {
    const { renderer } = makePerchSource();
    const armed = win({ name: "Armed", windowNumber: 42 });
    const invoke = vi.fn(async () => [armed]);
    const source = createPerchWatch({
      bus,
      renderer,
      invoke,
      getWindow: () => makeWindow({ x: 520, y: 740 }, 2),
      peekActive: () => false,
      setInterval,
      clearInterval,
    });
    source.adoptSit(42, { x: armed.x, y: armed.y }, 200, origin);
    return { source, invoke, armed, renderer };
  }

  it.each(["adopt", "commit"] as const)("arms the seat under its %s origin", (origin) => {
    expect(adopted(origin).source.armedSit()).toEqual({ windowNumber: 42, origin, charHpx: 200 });
  });

  it("arms the poll and pushes nothing", async () => {
    const { invoke } = adopted();
    expect(pushed).toEqual([]);

    await tick();
    expect(pushed).toEqual([]);

    // The adopted window vanishing detaches through the sit exit a drop would push.
    invoke.mockImplementation(async () => []);
    await tick();
    expect(pushed.map((e) => e.event_name)).toEqual(["user.window_sit_exit"]);
  });

  it("releases an adopted sit through the sit exit", () => {
    const { source } = adopted();
    source.release();
    expect(pushed.map((e) => e.event_name)).toEqual(["user.window_sit_exit"]);
  });

  it("names the armed sit window, and nothing once it is released", () => {
    const { source } = adopted();
    expect(source.armedSit()).toEqual({ windowNumber: 42, origin: "adopt", charHpx: 200 });
    source.release();
    expect(source.armedSit()).toBeNull();
  });

  it("stops polling while suspended and re-arms host-loss polling on resume", async () => {
    const { source, renderer, invoke } = adopted();

    expect(source.suspendSit()).toEqual({
      windowNumber: 42,
      origin: "adopt",
      rect: { x: 300, y: 400 },
      charHpx: 200,
    });
    expect(renderer.setPerchTarget).toHaveBeenCalledWith(null);
    expect(source.armedSit()).toEqual({ windowNumber: 42, origin: "adopt", charHpx: 200 });
    expect(pushed).toEqual([]);

    invoke.mockClear();
    await tick();
    await tick();
    expect(invoke).not.toHaveBeenCalled();

    source.resumeSit(420);

    expect(renderer.setPerchTarget).toHaveBeenLastCalledWith({ edgeLocalYpx: 420 });
    expect(source.armedSit()).toEqual({ windowNumber: 42, origin: "adopt", charHpx: 200 });
    expect(pushed).toEqual([]);

    invoke.mockImplementation(async () => []);
    await tick();
    await tick();
    expect(pushed.map((event) => event.event_name)).toEqual(["user.window_sit_exit"]);
  });

  it("leaves a live sit and its poll alone when nothing is suspended", async () => {
    const { source, renderer, invoke } = adopted();
    renderer.setPerchTarget.mockClear();
    invoke.mockClear();

    source.abandonSit();

    expect(source.armedSit()).toEqual({ windowNumber: 42, origin: "adopt", charHpx: 200 });
    expect(renderer.setPerchTarget).not.toHaveBeenCalled();
    await tick();
    expect(invoke).toHaveBeenCalled();
    expect(pushed).toEqual([]);
  });

  it("quietly abandons a suspended sit and prevents a later resume", async () => {
    const { source, renderer, invoke } = adopted();
    source.suspendSit();
    renderer.setPerchTarget.mockClear();

    source.abandonSit();
    source.resumeSit(420);
    await tick();

    expect(source.armedSit()).toBeNull();
    expect(renderer.setPerchTarget).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(pushed).toEqual([]);
  });
});
