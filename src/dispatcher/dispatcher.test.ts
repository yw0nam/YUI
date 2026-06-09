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
import { createDispatcher, type Dispatcher, type DispatcherState, DROP_SEVERITY } from "./dispatcher";
import { createEventBus, type EventBus, type BusEnvelope } from "./event-bus";
import type { BackendCaller, BackendCallResult } from "./backend-caller";
import type { CompactResult } from "../io/session-compactor";
import type { Logger } from "../logger";

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

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

let bus: EventBus;
let applyDirective: ReturnType<typeof vi.fn>;
let renderer: { applyDirective: typeof applyDirective };
let callDeferred: Array<{ resolve: (r: BackendCallResult) => void; signal?: AbortSignal }>;
let backendCaller: BackendCaller;
let dispatcher: Dispatcher;
let logger: Logger;

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
  logger = makeLogger();
  dispatcher = createDispatcher({ bus, renderer: renderer as never, backendCaller, logger });
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

// ── #76 structured logging ─────────────────────────────────────────────────────

describe("dispatcher — structured logging (#76): DROP_SEVERITY table", () => {
  it("exports DROP_SEVERITY mapping every DropRecord reason", () => {
    expect(DROP_SEVERITY).toBeDefined();
    expect(DROP_SEVERITY.guardrail_drop).toBe("info");
    expect(DROP_SEVERITY.parse_error).toBe("warn");
    expect(DROP_SEVERITY.network_drop).toBe("warn");
    expect(DROP_SEVERITY.http_4xx_drop).toBe("error");
    expect(DROP_SEVERITY.superseded_by_user).toBe("info");
    expect(DROP_SEVERITY.stale_pending).toBe("info");
  });
});

describe("dispatcher — structured logging (#76): state_change events", () => {
  it("emits logger.info('state_change', {from:'booting', to:'running'}) on start()", () => {
    dispatcher.start();
    expect(logger.info).toHaveBeenCalledWith(
      "state_change",
      expect.objectContaining({ from: "booting", to: "running" }),
    );
  });

  it("emits logger.info('state_change', {from:'running', to:'stopped'}) on stop()", () => {
    dispatcher.start();
    (logger.info as ReturnType<typeof vi.fn>).mockClear();
    dispatcher.stop();
    expect(logger.info).toHaveBeenCalledWith(
      "state_change",
      expect.objectContaining({ from: "running", to: "stopped" }),
    );
  });
});

describe("dispatcher — structured logging (#76): fire events", () => {
  it("emits logger.info('fire', {seq_id, event_name, tier}) for a tier1 drag_start", async () => {
    dispatcher.start();
    bus.push(env({ event_name: "user.drag_start", hint_tier: 1 }));
    await vi.advanceTimersByTimeAsync(20);
    expect(logger.info).toHaveBeenCalledWith(
      "fire",
      expect.objectContaining({ event_name: "user.drag_start", tier: 1 }),
    );
  });

  it("emits logger.info('fire', {seq_id, event_name, tier}) for a tier2 user.text_submitted", async () => {
    dispatcher.start();
    bus.push(env());
    await vi.advanceTimersByTimeAsync(20);
    expect(logger.info).toHaveBeenCalledWith(
      "fire",
      expect.objectContaining({ event_name: "user.text_submitted", tier: 2 }),
    );
  });

  it("emits logger.info('fire', {seq_id}) for idle.returned (tier1)", async () => {
    dispatcher.start();
    bus.push(env({ source: "idle_watcher", event_name: "idle.returned", hint_tier: 1, dnd_override: false }));
    await vi.advanceTimersByTimeAsync(20);
    expect(logger.info).toHaveBeenCalledWith(
      "fire",
      expect.objectContaining({ event_name: "idle.returned", seq_id: expect.anything() }),
    );
  });
});

describe("dispatcher — structured logging (#76): backend_call events", () => {
  it("emits logger.info('backend_call', {trigger, seq_id, started_at}) at call start", async () => {
    dispatcher.start();
    bus.push(env());
    await vi.advanceTimersByTimeAsync(20);
    expect(logger.info).toHaveBeenCalledWith(
      "backend_call",
      expect.objectContaining({ seq_id: expect.anything(), started_at: expect.any(Number) }),
    );
  });

  it("emits logger.info('backend_call', {trigger, outcome:'ok'}) on successful completion", async () => {
    dispatcher.start();
    bus.push(env());
    await vi.advanceTimersByTimeAsync(20);
    callDeferred[0].resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(20);
    expect(logger.info).toHaveBeenCalledWith(
      "backend_call",
      expect.objectContaining({ outcome: "ok" }),
    );
  });

  it("emits logger.info('backend_call', {outcome: drop_reason}) on parse_error", async () => {
    dispatcher.start();
    bus.push(env());
    await vi.advanceTimersByTimeAsync(20);
    callDeferred[0].resolve({ ok: false, drop_reason: "parse_error" });
    await vi.advanceTimersByTimeAsync(20);
    expect(logger.info).toHaveBeenCalledWith(
      "backend_call",
      expect.objectContaining({ outcome: "parse_error" }),
    );
  });
});

describe("dispatcher — structured logging (#76): drop events via logger", () => {
  it("emits logger.warn('drop', ...) for parse_error via DROP_SEVERITY", async () => {
    dispatcher.start();
    bus.push(env());
    await vi.advanceTimersByTimeAsync(20);
    callDeferred[0].resolve({ ok: false, drop_reason: "parse_error" });
    await vi.advanceTimersByTimeAsync(20);
    expect(logger.warn).toHaveBeenCalledWith(
      "drop",
      expect.objectContaining({ reason: "parse_error", seq_id: expect.anything(), event_name: expect.any(String) }),
    );
  });

  it("emits logger.warn('drop', ...) for network_drop via DROP_SEVERITY", async () => {
    dispatcher.start();
    bus.push(env());
    await vi.advanceTimersByTimeAsync(20);
    callDeferred[0].resolve({ ok: false, drop_reason: "network_drop" });
    await vi.advanceTimersByTimeAsync(20);
    expect(logger.warn).toHaveBeenCalledWith(
      "drop",
      expect.objectContaining({ reason: "network_drop", seq_id: expect.anything(), event_name: expect.any(String) }),
    );
  });

  it("emits logger.info('drop', ...) for superseded_by_user via DROP_SEVERITY", async () => {
    dispatcher.start();
    // occupy in-flight
    bus.push(env({ ts: NOW }));
    await vi.advanceTimersByTimeAsync(20);
    // queue a tier2 behind the in-flight
    bus.push(env({ source: "idle_watcher", event_name: "idle.short", ts: NOW + 1, hint_tier: 2, dnd_override: false }));
    // new user message supersedes
    bus.push(env({ ts: NOW + 2 }));
    await vi.advanceTimersByTimeAsync(20);
    expect(logger.info).toHaveBeenCalledWith(
      "drop",
      expect.objectContaining({ reason: "superseded_by_user", event_name: expect.any(String) }),
    );
  });

  it("emits logger.info('drop', ...) for stale_pending via DROP_SEVERITY", async () => {
    dispatcher.start();
    // occupy in-flight with first tier2
    bus.push(env({ ts: NOW }));
    await vi.advanceTimersByTimeAsync(20);
    expect(callDeferred).toHaveLength(1);
    // push two more tier2 while in-flight — oldest pending gets stale_pending drop
    bus.push(env({ source: "idle_watcher", event_name: "idle.short", ts: NOW + 1, hint_tier: 2, dnd_override: false }));
    bus.push(env({ source: "idle_watcher", event_name: "idle.long", ts: NOW + 2, hint_tier: 2, dnd_override: false }));
    await vi.advanceTimersByTimeAsync(20);
    expect(logger.info).toHaveBeenCalledWith(
      "drop",
      expect.objectContaining({ reason: "stale_pending", event_name: expect.any(String) }),
    );
  });
});

// ── #128 P5 compacting state ───────────────────────────────────────────────────

/** Controllable compact thunk: capture each call's signal + a settle handle. */
interface CompactCall {
  signal: AbortSignal;
  resolve: (r: CompactResult) => void;
  reject: (e: unknown) => void;
}
function makeCompact(): {
  thunk: ReturnType<typeof vi.fn>;
  calls: CompactCall[];
} {
  const calls: CompactCall[] = [];
  const thunk = vi.fn((signal: AbortSignal) => {
    return new Promise<CompactResult>((resolve, reject) => {
      calls.push({ signal, resolve, reject });
    });
  });
  return { thunk, calls };
}

/** Build a dispatcher wired with compact deps. Defaults to a live session id. */
function makeCompactingDispatcher(over: {
  compact?: ReturnType<typeof vi.fn>;
  getSessionId?: () => string | undefined;
  compactTimeoutMs?: number;
} = {}): Dispatcher {
  const compact = over.compact ?? makeCompact().thunk;
  const getSessionId = over.getSessionId ?? (() => "sess-1");
  return createDispatcher({
    bus,
    renderer: renderer as never,
    backendCaller,
    logger,
    compact: compact as never,
    getSessionId,
    compactTimeoutMs: over.compactTimeoutMs,
  });
}

describe("dispatcher — compacting: queue-level gate (BLOCKER 1)", () => {
  it("does NOT launch a pending turn via drainPending after a compaction is latched", async () => {
    const { thunk } = makeCompact();
    dispatcher = makeCompactingDispatcher({ compact: thunk });
    dispatcher.start();

    // first user turn occupies the in-flight slot
    bus.push(env({ ts: NOW }));
    await vi.advanceTimersByTimeAsync(20);
    expect(callDeferred).toHaveLength(1);

    // a tier2 idle turn queues behind it (would normally launch on settle)
    bus.push(env({ source: "idle_watcher", event_name: "idle.short", ts: NOW + 1, hint_tier: 2, dnd_override: false }));
    await vi.advanceTimersByTimeAsync(20);

    // latch a compaction while the first turn is still in flight
    dispatcher.requestCompaction();

    // settle the in-flight turn — its .finally() must NOT launch the pending turn
    callDeferred[0].resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(20);

    // no second backend call — instead we entered compacting
    expect((backendCaller.call as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect(dispatcher.state()).toBe("compacting");
  });
});

describe("dispatcher — compacting: enter/exit transitions (BLOCKER 2)", () => {
  it("from idle, requestCompaction enters compacting and calls compact once", () => {
    const { thunk, calls } = makeCompact();
    dispatcher = makeCompactingDispatcher({ compact: thunk });
    dispatcher.start();
    expect(dispatcher.state()).toBe("running");

    dispatcher.requestCompaction();
    expect(dispatcher.state()).toBe("compacting");
    expect(thunk).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
  });

  it("on compact resolve, returns to running and drains held events", async () => {
    const { thunk, calls } = makeCompact();
    dispatcher = makeCompactingDispatcher({ compact: thunk });
    dispatcher.start();

    // hold a tier2 turn while compaction is latched
    dispatcher.requestCompaction();
    expect(dispatcher.state()).toBe("compacting");
    bus.push(env({ source: "idle_watcher", event_name: "idle.short", ts: NOW + 1, hint_tier: 2, dnd_override: false }));
    await vi.advanceTimersByTimeAsync(20);
    // held — no backend call while compacting
    expect((backendCaller.call as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();

    calls[0].resolve({ status: "compressed", session_id: "sess-2" });
    await vi.advanceTimersByTimeAsync(20);

    expect(dispatcher.state()).toBe("running");
    // the held turn now launches
    expect((backendCaller.call as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });
});

describe("dispatcher — compacting: timeout (BLOCKER 3)", () => {
  it("a hung compact returns to running after compactTimeoutMs and aborts the signal", async () => {
    const { thunk, calls } = makeCompact();
    dispatcher = makeCompactingDispatcher({ compact: thunk, compactTimeoutMs: 5000 });
    dispatcher.start();

    dispatcher.requestCompaction();
    expect(dispatcher.state()).toBe("compacting");
    expect(calls[0].signal.aborted).toBe(false);

    // compact never resolves — advance past the timeout
    await vi.advanceTimersByTimeAsync(5001);

    expect(dispatcher.state()).toBe("running");
    expect(calls[0].signal.aborted).toBe(true);
  });
});

describe("dispatcher — compacting: error / skipped settle paths", () => {
  it("returns to running when compact rejects", async () => {
    const { thunk, calls } = makeCompact();
    dispatcher = makeCompactingDispatcher({ compact: thunk });
    dispatcher.start();
    dispatcher.requestCompaction();
    expect(dispatcher.state()).toBe("compacting");

    calls[0].reject(new Error("boom"));
    await vi.advanceTimersByTimeAsync(20);
    expect(dispatcher.state()).toBe("running");
  });

  it("returns to running when compact resolves error", async () => {
    const { thunk, calls } = makeCompact();
    dispatcher = makeCompactingDispatcher({ compact: thunk });
    dispatcher.start();
    dispatcher.requestCompaction();
    calls[0].resolve({ status: "error" });
    await vi.advanceTimersByTimeAsync(20);
    expect(dispatcher.state()).toBe("running");
  });

  it("returns to running when compact resolves skipped", async () => {
    const { thunk, calls } = makeCompact();
    dispatcher = makeCompactingDispatcher({ compact: thunk });
    dispatcher.start();
    dispatcher.requestCompaction();
    calls[0].resolve({ status: "skipped" });
    await vi.advanceTimersByTimeAsync(20);
    expect(dispatcher.state()).toBe("running");
  });
});

describe("dispatcher — compacting: idempotent / swallowed", () => {
  it("two requestCompaction in a row → compact called once", () => {
    const { thunk } = makeCompact();
    dispatcher = makeCompactingDispatcher({ compact: thunk });
    dispatcher.start();
    dispatcher.requestCompaction();
    dispatcher.requestCompaction();
    expect(thunk).toHaveBeenCalledTimes(1);
  });

  it("requestCompaction while compacting is ignored", () => {
    const { thunk } = makeCompact();
    dispatcher = makeCompactingDispatcher({ compact: thunk });
    dispatcher.start();
    dispatcher.requestCompaction();
    expect(dispatcher.state()).toBe("compacting");
    dispatcher.requestCompaction();
    expect(thunk).toHaveBeenCalledTimes(1);
  });

  it("requestCompaction with no session id does NOT call compact", () => {
    const { thunk } = makeCompact();
    dispatcher = makeCompactingDispatcher({ compact: thunk, getSessionId: () => undefined });
    dispatcher.start();
    dispatcher.requestCompaction();
    expect(thunk).not.toHaveBeenCalled();
    expect(dispatcher.state()).toBe("running");
  });

  it("requestCompaction with no compact dep is a no-op", () => {
    // dispatcher from beforeEach has no compact dep
    dispatcher.start();
    expect(() => dispatcher.requestCompaction()).not.toThrow();
    expect(dispatcher.state()).toBe("running");
  });
});

describe("dispatcher — compacting: subscribeState observable", () => {
  it("notifies running→compacting→running and stops after unsubscribe", async () => {
    const { thunk, calls } = makeCompact();
    dispatcher = makeCompactingDispatcher({ compact: thunk });
    const seen: DispatcherState[] = [];
    const unsub = dispatcher.subscribeState((s) => seen.push(s));

    dispatcher.start();
    expect(seen).toContain("running");

    dispatcher.requestCompaction();
    expect(seen).toContain("compacting");

    calls[0].resolve({ status: "skipped" });
    await vi.advanceTimersByTimeAsync(20);
    expect(seen.filter((s) => s === "running")).toHaveLength(2);

    unsub();
    seen.length = 0;
    dispatcher.stop();
    expect(seen).toHaveLength(0);
  });
});

describe("dispatcher — compacting: stop during compacting", () => {
  it("stop() aborts the compact signal and ends stopped; later settle does not flip to running", async () => {
    const { thunk, calls } = makeCompact();
    dispatcher = makeCompactingDispatcher({ compact: thunk });
    dispatcher.start();
    dispatcher.requestCompaction();
    expect(dispatcher.state()).toBe("compacting");
    expect(calls[0].signal.aborted).toBe(false);

    dispatcher.stop();
    expect(dispatcher.state()).toBe("stopped");
    expect(calls[0].signal.aborted).toBe(true);

    // the late settle must not resurrect the dispatcher
    calls[0].resolve({ status: "error" });
    await vi.advanceTimersByTimeAsync(20);
    expect(dispatcher.state()).toBe("stopped");
  });
});

describe("dispatcher — compacting: busy cue", () => {
  it("applies a thinking cue entering and a neutral cue leaving", async () => {
    const { thunk, calls } = makeCompact();
    dispatcher = makeCompactingDispatcher({ compact: thunk });
    dispatcher.start();
    applyDirective.mockClear();

    dispatcher.requestCompaction();
    const enterArg = applyDirective.mock.calls.at(-1)?.[0];
    expect(enterArg?.emotion?.id).toBe("thinking");

    applyDirective.mockClear();
    calls[0].resolve({ status: "skipped" });
    await vi.advanceTimersByTimeAsync(20);
    const leaveArg = applyDirective.mock.calls.find((c) => c[0]?.emotion?.id === "neutral");
    expect(leaveArg).toBeTruthy();
  });
});
