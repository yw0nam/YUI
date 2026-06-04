/**
 * dispatcher.test.ts — classify → route + conflict resolution (event-dispatcher.md §5/§9/§11).
 *
 * MVP scope (#21 spine):
 *  - §5.1 classify: user.text_submitted (tier2) → backend_caller; user.drag_* / idle.returned
 *    / user.tap (tier1 half) → tier1/renderer.
 *  - §5.2 conflict: user.text_submitted arrival → abort in-flight backend call (AbortController)
 *    + drop queued tier2/3 (superseded_by_user).
 *  - §9 state machine booting → running.
 *  - §11 observable dev APIs (queue / recent_drops / in_flight).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDispatcher, type Dispatcher } from "./dispatcher";
import { createEventBus, type EventBus, type BusEnvelope } from "./event-bus";
import type { BackendCaller, BackendCallResult } from "./backend-caller";

const NOW = 1_717_000_000_000;

function env(over: Partial<BusEnvelope> = {}): BusEnvelope {
  return {
    source: "user_input_source",
    event_name: "user.text_submitted",
    ts: NOW,
    dnd_override: true,
    ...over,
  };
}

let bus: EventBus;
let applyDirective: ReturnType<typeof vi.fn>;
let renderer: { applyDirective: typeof applyDirective };
let callDeferred: Array<{ resolve: (r: BackendCallResult) => void; signal?: AbortSignal }>;
let backendCaller: BackendCaller;
let dispatcher: Dispatcher;

function makeBackendCaller(): BackendCaller {
  return {
    call: vi.fn((_e: BusEnvelope, signal?: AbortSignal) => {
      return new Promise<BackendCallResult>((resolve) => {
        callDeferred.push({ resolve, signal });
      });
    }),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  bus = createEventBus();
  applyDirective = vi.fn();
  renderer = { applyDirective };
  callDeferred = [];
  backendCaller = makeBackendCaller();
  dispatcher = createDispatcher({ bus, renderer: renderer as never, backendCaller });
});
afterEach(() => {
  dispatcher.stop();
  vi.useRealTimers();
});

describe("dispatcher — state machine (§9)", () => {
  it("starts booting, becomes running after start()", () => {
    expect(dispatcher.state()).toBe("booting");
    dispatcher.start();
    expect(dispatcher.state()).toBe("running");
  });
});

describe("dispatcher — routing (§5.1)", () => {
  it("routes user.text_submitted (tier2) to the backend caller", async () => {
    dispatcher.start();
    bus.push(env());
    await vi.advanceTimersByTimeAsync(20);
    expect((backendCaller.call as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it("routes user.drag_start (tier1) to renderer, NOT the backend", async () => {
    dispatcher.start();
    bus.push(env({ event_name: "user.drag_start", hint_tier: 1 }));
    await vi.advanceTimersByTimeAsync(20);
    expect((backendCaller.call as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(applyDirective).toHaveBeenCalled();
    const arg = applyDirective.mock.calls[0][0];
    expect(arg.motion?.id).toBe("drag");
  });

  it("routes idle.returned (tier1) to renderer without a backend call", async () => {
    dispatcher.start();
    bus.push(env({ source: "idle_watcher", event_name: "idle.returned", hint_tier: 1, dnd_override: false }));
    await vi.advanceTimersByTimeAsync(20);
    expect((backendCaller.call as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("user.tap fires a tier1 render reaction immediately", async () => {
    dispatcher.start();
    bus.push(env({ event_name: "user.tap", hint_tier: 1 }));
    await vi.advanceTimersByTimeAsync(20);
    expect(applyDirective).toHaveBeenCalled();
  });
});

describe("dispatcher — conflict resolution / supersede (§5.2, §14 ABORT path)", () => {
  it("aborts the in-flight backend call when a new user.text_submitted arrives", async () => {
    dispatcher.start();
    bus.push(env({ ts: NOW }));
    await vi.advanceTimersByTimeAsync(20);
    expect(callDeferred).toHaveLength(1);
    const first = callDeferred[0];
    expect(first.signal?.aborted).toBe(false);

    // second user message arrives while first is in flight
    bus.push(env({ ts: NOW + 1 }));
    await vi.advanceTimersByTimeAsync(20);
    expect(first.signal?.aborted).toBe(true);
  });

  it("drops queued tier2 events with superseded_by_user when a user message arrives", async () => {
    dispatcher.start();
    // first user text occupies the in-flight slot
    bus.push(env({ ts: NOW }));
    await vi.advanceTimersByTimeAsync(20);
    // queue a tier2 idle.short behind it (won't run while in-flight)
    bus.push(env({ source: "idle_watcher", event_name: "idle.short", ts: NOW + 1, hint_tier: 2, dnd_override: false }));
    // now a new user message supersedes
    bus.push(env({ ts: NOW + 2 }));
    await vi.advanceTimersByTimeAsync(20);
    const drops = dispatcher.recentDrops(10);
    expect(drops.some((d) => d.reason === "superseded_by_user")).toBe(true);
  });
});

describe("dispatcher — observable dev APIs (§11)", () => {
  it("in_flight reflects an active backend call and clears on completion", async () => {
    dispatcher.start();
    bus.push(env());
    await vi.advanceTimersByTimeAsync(20);
    expect(dispatcher.inFlight()).not.toBeNull();
    callDeferred[0].resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(20);
    expect(dispatcher.inFlight()).toBeNull();
  });

  it("queue() returns pending envelopes", async () => {
    dispatcher.start();
    bus.push(env());
    await vi.advanceTimersByTimeAsync(20);
    // first is in-flight; queue a second tier2 that stays pending
    bus.push(env({ source: "idle_watcher", event_name: "idle.short", ts: NOW + 1, hint_tier: 2, dnd_override: false }));
    await vi.advanceTimersByTimeAsync(20);
    expect(dispatcher.queue().length).toBeGreaterThan(0);
  });
});
