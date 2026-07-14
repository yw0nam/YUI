/**
 * dispatcher.test.ts — classify → route + conflict resolution.
 *
 * Scope:
 *  - §5.1 classify: user.text_submitted (tier2) → backend_caller; user.drag_* / idle.returned
 *    / user.tap (tier1 half) → tier1/renderer.
 *  - §5.2 conflict: user.text_submitted arrival → abort in-flight backend call (AbortController)
 *    + drop queued tier2/3 (superseded_by_user).
 *  - §9 state machine booting → running.
 *  - §11 observable dev APIs (queue / recent_drops / in_flight).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../logger";
import type { BackendCaller, BackendCallResult } from "./backend-caller";
import { createDispatcher, type Dispatcher, DROP_SEVERITY } from "./dispatcher";
import { type BusEnvelope, createEventBus, type EventBus } from "./event-bus";
import { createGuardrails, type Guardrails, type GuardrailsConfig } from "./guardrails";

const NOW = 1_717_000_000_000;

/**
 * 스파인(라우팅/supersede) 테스트용 permissive guardrails config — debounce 0, 넉넉한 cap.
 * 가드레일 자체 검증은 guardrails.test.ts 소관이므로 여기서는 간섭하지 않는다.
 */
function permissiveGuardrailsConfig(): GuardrailsConfig {
  return {
    dnd: { app_blocklist: [] },
    debounce_ms: {
      idle_watcher: 0,
      os_event_watcher: 0,
      backend_push_source: 0,
      user_input_source: 0,
    },
    rate_limit: {
      window_ms: 3_600_000,
      tier2_max: 1000,
      tier3_max: 1000,
      overall_max: 1000,
      cooldown_ms: 300_000,
    },
  };
}

/** §6 SOT 수치를 그대로 쓰는 guardrails config (게이팅 테스트용). */
function realGuardrailsConfig(): GuardrailsConfig {
  return {
    dnd: { app_blocklist: [] },
    debounce_ms: {
      idle_watcher: 30_000,
      os_event_watcher: 5_000,
      backend_push_source: 10_000,
      user_input_source: 0,
    },
    rate_limit: {
      window_ms: 3_600_000,
      tier2_max: 6,
      tier3_max: 2,
      overall_max: 20,
      cooldown_ms: 300_000,
    },
  };
}

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
let setPerchTarget: ReturnType<typeof vi.fn>;
let renderer: { applyDirective: typeof applyDirective; setPerchTarget: typeof setPerchTarget };
let callDeferred: Array<{ resolve: (r: BackendCallResult) => void; signal?: AbortSignal }>;
let backendCaller: BackendCaller;
let guardrails: Guardrails;
let dispatcher: Dispatcher;
let logger: Logger;
let speaking = false;

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
  setPerchTarget = vi.fn();
  renderer = { applyDirective, setPerchTarget };
  callDeferred = [];
  backendCaller = makeBackendCaller();
  guardrails = createGuardrails(permissiveGuardrailsConfig(), { now: () => Date.now() });
  logger = makeLogger();
  speaking = false;
  dispatcher = createDispatcher({
    bus,
    renderer: renderer as never,
    backendCaller,
    guardrails,
    isSpeaking: () => speaking,
    logger,
  });
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
    expect(backendCaller.call as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });

  it("routes user.drag_start (tier1) to renderer with drag motion + clears perch, NOT the backend", async () => {
    dispatcher.start();
    bus.push(env({ event_name: "user.drag_start", hint_tier: 1 }));
    await vi.advanceTimersByTimeAsync(20);
    expect(backendCaller.call as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(applyDirective).toHaveBeenCalled();
    const arg = applyDirective.mock.calls[0][0];
    expect(arg.motion?.id).toBe("drag");
    // grabbing a perched character clears the stale perch at grab.
    expect(setPerchTarget).toHaveBeenCalledWith(null);
    // perch-clear must run BEFORE applyDirective so the drag motion is the last
    // playMotion and is not clobbered by setPerchTarget(null)'s playMotion(null).
    expect(setPerchTarget.mock.invocationCallOrder[0]).toBeLessThan(
      applyDirective.mock.invocationCallOrder[0],
    );
  });

  it("routes idle.returned (tier1) to renderer without a backend call", async () => {
    dispatcher.start();
    bus.push(
      env({
        source: "idle_watcher",
        event_name: "idle.returned",
        hint_tier: 1,
        dnd_override: false,
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(backendCaller.call as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("user.tap fires a tier1 render reaction immediately", async () => {
    dispatcher.start();
    bus.push(env({ event_name: "user.tap", hint_tier: 1 }));
    await vi.advanceTimersByTimeAsync(20);
    expect(applyDirective).toHaveBeenCalled();
  });

  it("routes user.window_sit_enter (tier1) to renderer with window_sit motion, NOT the backend", async () => {
    dispatcher.start();
    bus.push(env({ event_name: "user.window_sit_enter", hint_tier: 1 }));
    await vi.advanceTimersByTimeAsync(20);
    expect(backendCaller.call as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(applyDirective).toHaveBeenCalled();
    const arg = applyDirective.mock.calls[0][0];
    expect(arg.motion?.id).toBe("window_sit");
  });

  it("routes user.window_sit_exit (tier1) to renderer with motion null, NOT the backend", async () => {
    dispatcher.start();
    bus.push(env({ event_name: "user.window_sit_exit", hint_tier: 1 }));
    await vi.advanceTimersByTimeAsync(20);
    expect(backendCaller.call as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(applyDirective).toHaveBeenCalled();
    const arg = applyDirective.mock.calls[0][0];
    expect(arg.motion).toBeNull();
  });

  it("routes proactive.cowork (tier2) to the backend caller", async () => {
    dispatcher.start();
    bus.push(
      env({
        source: "timer_scheduler",
        event_name: "proactive.cowork",
        ts: NOW,
        dnd_override: false,
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(backendCaller.call as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      "fire",
      expect.objectContaining({ event_name: "proactive.cowork", tier: 2 }),
    );
  });

  it("routes schedule.morning (tier2) to backend_caller", async () => {
    dispatcher.start();
    bus.push(
      env({
        source: "timer_scheduler",
        event_name: "schedule.morning",
        ts: NOW,
        hint_tier: 2,
        dnd_override: false,
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(backendCaller.call as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });

  it("routes proactive.<id> (tier2) to backend_caller", async () => {
    dispatcher.start();
    bus.push(
      env({
        source: "timer_scheduler",
        event_name: "proactive.mid_check",
        ts: NOW,
        hint_tier: 2,
        dnd_override: false,
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(backendCaller.call as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });

  it("routes agent.done (tier2) to backend_caller, NOT dropped", async () => {
    dispatcher.start();
    bus.push(
      env({
        source: "timer_scheduler",
        event_name: "agent.done",
        ts: NOW,
        dnd_override: false,
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(backendCaller.call as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      "fire",
      expect.objectContaining({ event_name: "agent.done", tier: 2 }),
    );
  });

  it("routes agent.catchup (tier2) to backend_caller", async () => {
    dispatcher.start();
    bus.push(
      env({
        source: "timer_scheduler",
        event_name: "agent.catchup",
        ts: NOW,
        dnd_override: false,
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(backendCaller.call as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });

  it("routes signals.push (tier2, dnd_override false — github parity) to backend_caller, NOT dropped", async () => {
    dispatcher.start();
    bus.push(
      env({
        source: "timer_scheduler",
        event_name: "signals.push",
        ts: NOW,
        dnd_override: false,
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(backendCaller.call as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      "fire",
      expect.objectContaining({ event_name: "signals.push", tier: 2 }),
    );
  });

  it("routes signals.catchup (tier2) to backend_caller", async () => {
    dispatcher.start();
    bus.push(
      env({
        source: "timer_scheduler",
        event_name: "signals.catchup",
        ts: NOW,
        dnd_override: false,
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(backendCaller.call as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });

  it("routes user.window_sit_drop (tier1) to renderer with window_sit motion + setPerchTarget, NOT the backend", async () => {
    dispatcher.start();
    bus.push(
      env({
        source: "os_event_watcher",
        event_name: "user.window_sit_drop",
        hint_tier: 1,
        payload: { edge_local_ypx: 30 },
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(backendCaller.call as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(applyDirective).toHaveBeenCalled();
    const arg = applyDirective.mock.calls[0][0];
    expect(arg.motion?.id).toBe("window_sit");
    expect(setPerchTarget).toHaveBeenCalledWith({ edgeLocalYpx: 30 });
  });

  it("clears the perch on user.window_sit_exit via setPerchTarget(null)", async () => {
    dispatcher.start();
    bus.push(env({ event_name: "user.window_sit_exit", hint_tier: 1 }));
    await vi.advanceTimersByTimeAsync(20);
    expect(setPerchTarget).toHaveBeenCalledWith(null);
  });

  it("does NOT set a perch target on user.window_sit_enter (sit in place)", async () => {
    dispatcher.start();
    bus.push(env({ event_name: "user.window_sit_enter", hint_tier: 1 }));
    await vi.advanceTimersByTimeAsync(20);
    expect(setPerchTarget).not.toHaveBeenCalled();
  });

  it("skips setPerchTarget when user.window_sit_drop payload is malformed (still renders window_sit)", async () => {
    dispatcher.start();
    bus.push(
      env({
        source: "os_event_watcher",
        event_name: "user.window_sit_drop",
        hint_tier: 1,
        payload: {}, // no edge_local_ypx
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    const arg = applyDirective.mock.calls[0][0];
    expect(arg.motion?.id).toBe("window_sit");
    expect(setPerchTarget).not.toHaveBeenCalled();
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
    bus.push(
      env({
        source: "idle_watcher",
        event_name: "idle.short",
        ts: NOW + 1,
        hint_tier: 2,
        dnd_override: false,
      }),
    );
    // now a new user message supersedes
    bus.push(env({ ts: NOW + 2 }));
    await vi.advanceTimersByTimeAsync(20);
    const drops = dispatcher.recentDrops(10);
    expect(drops.some((d) => d.reason === "superseded_by_user")).toBe(true);
  });
});

describe("dispatcher — playback-gated drain (§337)", () => {
  const nonUser = (over: Partial<BusEnvelope> = {}) =>
    env({
      source: "backend_push_source",
      event_name: "proactive.tick",
      ts: NOW + 1,
      hint_tier: 2,
      dnd_override: false,
      ...over,
    });

  async function holdNonUserBehindCompletedCall(): Promise<BusEnvelope> {
    dispatcher.start();
    bus.push(env());
    await vi.advanceTimersByTimeAsync(20);
    const queued = nonUser();
    bus.push(queued);
    await vi.advanceTimersByTimeAsync(20);
    speaking = true;
    callDeferred[0].resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(20);
    return queued;
  }

  it("holds a queued non-user turn while speech is playing", async () => {
    const queued = await holdNonUserBehindCompletedCall();

    expect(backendCaller.call as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    expect(dispatcher.inFlight()).toBeNull();
    expect(dispatcher.queue()).toContain(queued);
    expect(dispatcher.recentDrops(10).map((drop) => drop.event_name)).not.toContain(
      queued.event_name,
    );
  });

  it("drains the held non-user turn after playback ends", async () => {
    await holdNonUserBehindCompletedCall();

    speaking = false;
    await vi.advanceTimersByTimeAsync(20);

    expect(backendCaller.call as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(2);
    expect(dispatcher.inFlight()).not.toBeNull();
  });

  it("lets a user turn supersede immediately while speech is playing", async () => {
    dispatcher.start();
    const first = nonUser({ ts: NOW });
    const queued = nonUser({ event_name: "proactive.queued", ts: NOW + 1 });
    bus.push(first);
    await vi.advanceTimersByTimeAsync(20);
    bus.push(queued);
    await vi.advanceTimersByTimeAsync(20);
    speaking = true;

    bus.push(env({ ts: NOW + 2 }));
    await vi.advanceTimersByTimeAsync(20);

    expect(callDeferred[0].signal?.aborted).toBe(true);
    expect(dispatcher.recentDrops(10)).toContainEqual(
      expect.objectContaining({
        event_name: queued.event_name,
        reason: "superseded_by_user",
      }),
    );
  });

  it("drains a queued voice turn immediately while speech is playing", async () => {
    dispatcher.start();
    bus.push(nonUser({ ts: NOW }));
    await vi.advanceTimersByTimeAsync(20);
    bus.push(
      env({
        event_name: "user.voice_segment_ready",
        ts: NOW + 1,
        payload: { text: "안녕" },
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    speaking = true;

    callDeferred[0].resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(20);

    expect(backendCaller.call as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(2);
    expect(dispatcher.inFlight()?.trigger.event_name).toBe("user.voice_segment_ready");
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
    bus.push(
      env({
        source: "idle_watcher",
        event_name: "idle.short",
        ts: NOW + 1,
        hint_tier: 2,
        dnd_override: false,
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(dispatcher.queue().length).toBeGreaterThan(0);
  });
});

// ── structured logging ──────────────────────────────────────────────────────

describe("dispatcher — structured logging: DROP_SEVERITY table", () => {
  it("exports DROP_SEVERITY mapping every DropRecord reason", () => {
    expect(DROP_SEVERITY).toBeDefined();
    expect(DROP_SEVERITY.guardrail_drop).toBe("info");
    expect(DROP_SEVERITY.parse_error).toBe("warn");
    expect(DROP_SEVERITY.network_drop).toBe("warn");
    expect(DROP_SEVERITY.http_4xx_drop).toBe("error");
    expect(DROP_SEVERITY.superseded_by_user).toBe("info");
    expect(DROP_SEVERITY.stale_pending).toBe("info");
    expect(DROP_SEVERITY.degraded_drop).toBe("warn");
  });
});

describe("dispatcher — structured logging: state_change events", () => {
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

describe("dispatcher — structured logging: fire events", () => {
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
    bus.push(
      env({
        source: "idle_watcher",
        event_name: "idle.returned",
        hint_tier: 1,
        dnd_override: false,
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(logger.info).toHaveBeenCalledWith(
      "fire",
      expect.objectContaining({ event_name: "idle.returned", seq_id: expect.anything() }),
    );
  });
});

describe("dispatcher — structured logging: backend_call events", () => {
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

describe("dispatcher — onUserTurnFailed seam (issue #274)", () => {
  function makeDispatcherWithFailedTurnSink(): {
    d: Dispatcher;
    sink: ReturnType<typeof vi.fn>;
  } {
    const sink = vi.fn();
    const d = createDispatcher({
      bus,
      renderer: renderer as never,
      backendCaller,
      guardrails,
      logger,
      onUserTurnFailed: sink,
    });
    return { d, sink };
  }

  it("fires for a failed user.text_submitted turn with the classified reason + source:'text'", async () => {
    const { d, sink } = makeDispatcherWithFailedTurnSink();
    d.start();
    bus.push(env({ event_name: "user.text_submitted" }));
    await vi.advanceTimersByTimeAsync(20);
    callDeferred[0].resolve({ ok: false, drop_reason: "network_drop" });
    await vi.advanceTimersByTimeAsync(20);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith("network_drop", "text");
    d.stop();
  });

  it("fires for a failed user.voice_segment_ready turn with source:'voice'", async () => {
    const { d, sink } = makeDispatcherWithFailedTurnSink();
    d.start();
    bus.push(env({ event_name: "user.voice_segment_ready", payload: { text: "안녕" } }));
    await vi.advanceTimersByTimeAsync(20);
    callDeferred[0].resolve({ ok: false, drop_reason: "parse_error" });
    await vi.advanceTimersByTimeAsync(20);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith("parse_error", "voice");
    d.stop();
  });

  it("passes through http_4xx_drop unchanged", async () => {
    const { d, sink } = makeDispatcherWithFailedTurnSink();
    d.start();
    bus.push(env({ event_name: "user.text_submitted" }));
    await vi.advanceTimersByTimeAsync(20);
    callDeferred[0].resolve({ ok: false, drop_reason: "http_4xx_drop" });
    await vi.advanceTimersByTimeAsync(20);
    expect(sink).toHaveBeenCalledWith("http_4xx_drop", "text");
    d.stop();
  });

  it("does NOT fire for a non-user-initiated trigger (idle.short), even on failure", async () => {
    const { d, sink } = makeDispatcherWithFailedTurnSink();
    d.start();
    bus.push(env({ event_name: "idle.short", dnd_override: undefined, source: "idle_watcher" }));
    await vi.advanceTimersByTimeAsync(20);
    callDeferred[0].resolve({ ok: false, drop_reason: "network_drop" });
    await vi.advanceTimersByTimeAsync(20);
    expect(sink).not.toHaveBeenCalled();
    d.stop();
  });

  it("does NOT fire when the drop_reason is superseded_by_user", async () => {
    const { d, sink } = makeDispatcherWithFailedTurnSink();
    d.start();
    bus.push(env({ event_name: "user.text_submitted" }));
    await vi.advanceTimersByTimeAsync(20);
    callDeferred[0].resolve({ ok: false, drop_reason: "superseded_by_user" });
    await vi.advanceTimersByTimeAsync(20);
    expect(sink).not.toHaveBeenCalled();
    d.stop();
  });

  it("does NOT fire on a successful user turn", async () => {
    const { d, sink } = makeDispatcherWithFailedTurnSink();
    d.start();
    bus.push(env({ event_name: "user.text_submitted" }));
    await vi.advanceTimersByTimeAsync(20);
    callDeferred[0].resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(20);
    expect(sink).not.toHaveBeenCalled();
    d.stop();
  });
});

describe("dispatcher — structured logging: drop events via logger", () => {
  it("emits logger.warn('drop', ...) for parse_error via DROP_SEVERITY", async () => {
    dispatcher.start();
    bus.push(env());
    await vi.advanceTimersByTimeAsync(20);
    callDeferred[0].resolve({ ok: false, drop_reason: "parse_error" });
    await vi.advanceTimersByTimeAsync(20);
    expect(logger.warn).toHaveBeenCalledWith(
      "drop",
      expect.objectContaining({
        reason: "parse_error",
        seq_id: expect.anything(),
        event_name: expect.any(String),
      }),
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
      expect.objectContaining({
        reason: "network_drop",
        seq_id: expect.anything(),
        event_name: expect.any(String),
      }),
    );
  });

  it("emits logger.info('drop', ...) for superseded_by_user via DROP_SEVERITY", async () => {
    dispatcher.start();
    // occupy in-flight
    bus.push(env({ ts: NOW }));
    await vi.advanceTimersByTimeAsync(20);
    // queue a tier2 behind the in-flight
    bus.push(
      env({
        source: "idle_watcher",
        event_name: "idle.short",
        ts: NOW + 1,
        hint_tier: 2,
        dnd_override: false,
      }),
    );
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
    bus.push(
      env({
        source: "idle_watcher",
        event_name: "idle.short",
        ts: NOW + 1,
        hint_tier: 2,
        dnd_override: false,
      }),
    );
    bus.push(
      env({
        source: "idle_watcher",
        event_name: "idle.long",
        ts: NOW + 2,
        hint_tier: 2,
        dnd_override: false,
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(logger.info).toHaveBeenCalledWith(
      "drop",
      expect.objectContaining({ reason: "stale_pending", event_name: expect.any(String) }),
    );
  });
});

// ── guardrail gating ───────────────────────────

describe("dispatcher — guardrail gating (§6)", () => {
  /** real-config(§6 수치) 가드레일을 단 dispatcher를 만든다. */
  function makeGated(): { d: Dispatcher; g: Guardrails } {
    const g = createGuardrails(realGuardrailsConfig(), { now: () => Date.now() });
    const d = createDispatcher({
      bus,
      renderer: renderer as never,
      backendCaller,
      guardrails: g,
      logger,
    });
    return { d, g };
  }

  it("DND on → tier2 backend firing is dropped (guardrail_drop) and not enqueued", async () => {
    const { d, g } = makeGated();
    d.start();
    g.note(
      env({ source: "os_event_watcher", event_name: "os.fullscreen_entered", dnd_override: false }),
    );
    bus.push(
      env({ source: "idle_watcher", event_name: "idle.long", hint_tier: 2, dnd_override: false }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(backendCaller.call as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(d.recentDrops(10).some((dr) => dr.reason === "guardrail_drop")).toBe(true);
    d.stop();
  });

  it("note() flips DND from a fullscreen bus event passed through the dispatcher", async () => {
    const { d, g } = makeGated();
    d.start();
    // dispatcher.handle() must call guardrails.note() — a fullscreen event flips DND state.
    bus.push(
      env({
        source: "os_event_watcher",
        event_name: "os.fullscreen_entered",
        hint_tier: 3,
        dnd_override: false,
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(g.dndState().on).toBe(true);
    d.stop();
  });

  it("tier1 is NEVER gated under DND", async () => {
    const { d, g } = makeGated();
    d.start();
    g.setDnd("manual", true);
    bus.push(
      env({
        source: "user_input_source",
        event_name: "user.drag_start",
        hint_tier: 1,
        dnd_override: false,
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(applyDirective).toHaveBeenCalled();
    d.stop();
  });

  it("dnd_override user turns pass the guardrail and reach the backend even under DND", async () => {
    const { d, g } = makeGated();
    d.start();
    g.setDnd("manual", true);
    bus.push(env()); // default env: user.text_submitted, dnd_override:true
    await vi.advanceTimersByTimeAsync(20);
    expect(backendCaller.call as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    d.stop();
  });

  it("debounce drops a 2nd same-source tier2 within the window", async () => {
    const { d } = makeGated();
    d.start();
    bus.push(
      env({
        source: "idle_watcher",
        event_name: "idle.long",
        ts: NOW,
        hint_tier: 2,
        dnd_override: false,
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    callDeferred[0]?.resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(20);
    (backendCaller.call as ReturnType<typeof vi.fn>).mockClear();
    // 2nd idle within 30s — debounce drop, no new backend call.
    bus.push(
      env({
        source: "idle_watcher",
        event_name: "idle.long",
        ts: NOW + 1,
        hint_tier: 2,
        dnd_override: false,
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(backendCaller.call as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(d.recentDrops(10).some((dr) => dr.reason === "guardrail_drop")).toBe(true);
    d.stop();
  });
});

describe("dispatcher — cancel() + subscribeBusy (chat stop button)", () => {
  it("cancel() aborts the in-flight backend call", async () => {
    dispatcher.start();
    bus.push(env({ ts: NOW }));
    await vi.advanceTimersByTimeAsync(20);
    expect(callDeferred).toHaveLength(1);
    expect(callDeferred[0].signal?.aborted).toBe(false);

    dispatcher.cancel();
    expect(callDeferred[0].signal?.aborted).toBe(true);
    expect(dispatcher.inFlight()).toBeNull();
  });

  it("cancel() drops pending tier2/3 with superseded_by_user", async () => {
    dispatcher.start();
    // occupy in-flight
    bus.push(env({ ts: NOW }));
    await vi.advanceTimersByTimeAsync(20);
    // queue a tier2 behind it
    bus.push(
      env({
        source: "idle_watcher",
        event_name: "idle.short",
        ts: NOW + 1,
        hint_tier: 2,
        dnd_override: false,
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(dispatcher.queue().length).toBeGreaterThan(0);

    dispatcher.cancel();
    expect(dispatcher.queue()).toHaveLength(0);
    expect(dispatcher.recentDrops(10).some((d) => d.reason === "superseded_by_user")).toBe(true);
  });

  it("cancel() with nothing in flight is a no-op (no throw)", () => {
    dispatcher.start();
    expect(() => dispatcher.cancel()).not.toThrow();
    expect(dispatcher.inFlight()).toBeNull();
  });

  it("subscribeBusy fires true when a backend call starts, false when it completes", async () => {
    const seen: boolean[] = [];
    dispatcher.subscribeBusy((b) => seen.push(b));
    dispatcher.start();
    bus.push(env());
    await vi.advanceTimersByTimeAsync(20);
    expect(seen).toEqual([true]);
    callDeferred[0].resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(20);
    expect(seen).toEqual([true, false]);
  });

  it("subscribeBusy fires false when cancel() aborts the in-flight call", async () => {
    const seen: boolean[] = [];
    dispatcher.subscribeBusy((b) => seen.push(b));
    dispatcher.start();
    bus.push(env());
    await vi.advanceTimersByTimeAsync(20);
    expect(seen).toEqual([true]);
    dispatcher.cancel();
    expect(seen).toEqual([true, false]);
  });

  it("subscribeBusy does NOT double-fire across a drainPending hand-off (no spurious false)", async () => {
    const seen: boolean[] = [];
    dispatcher.start();
    // occupy in-flight with first tier2
    bus.push(env({ ts: NOW }));
    await vi.advanceTimersByTimeAsync(20);
    // queue a second tier2 that stays pending
    bus.push(
      env({
        source: "idle_watcher",
        event_name: "idle.short",
        ts: NOW + 1,
        hint_tier: 2,
        dnd_override: false,
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    // subscribe only now: busy is already true and stays true across the hand-off.
    dispatcher.subscribeBusy((b) => seen.push(b));
    // first completes → drainPending immediately starts the pending one (busy stays true).
    callDeferred[0].resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(20);
    expect(seen).toEqual([]); // no false→...→true flicker on the boundary
    // second completes with nothing pending → now busy flips to false once.
    callDeferred[1].resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(20);
    expect(seen).toEqual([false]);
  });

  it("subscribeBusy unsubscribe stops further notifications", async () => {
    const seen: boolean[] = [];
    const off = dispatcher.subscribeBusy((b) => seen.push(b));
    dispatcher.start();
    bus.push(env());
    await vi.advanceTimersByTimeAsync(20);
    expect(seen).toEqual([true]);
    off();
    callDeferred[0].resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(20);
    expect(seen).toEqual([true]);
  });
});

describe("dispatcher — cooldown state mirror (§6.3/§9)", () => {
  it("overall-cap overflow flips state() to 'cooldown' and back to 'running'; tier1 still renders", async () => {
    const cfg = realGuardrailsConfig();
    cfg.rate_limit.tier2_max = 1000; // make overall cap the binding constraint
    cfg.debounce_ms.user_input_source = 0;
    const g = createGuardrails(cfg, { now: () => Date.now() });
    const d = createDispatcher({
      bus,
      renderer: renderer as never,
      backendCaller,
      guardrails: g,
      logger,
    });
    d.start();

    // 21 non-override tier2 user firings → 21st enters cooldown.
    for (let i = 0; i < 21; i++) {
      bus.push(
        env({
          source: "user_input_source",
          event_name: "user.text_submitted",
          ts: NOW + i,
          dnd_override: false,
        }),
      );
      await vi.advanceTimersByTimeAsync(20);
      // resolve any in-flight so the next can start.
      callDeferred[callDeferred.length - 1]?.resolve({ ok: true });
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(g.cooldownActive()).toBe(true);
    expect(d.state()).toBe("cooldown");

    // tier1 still renders during cooldown.
    applyDirective.mockClear();
    bus.push(
      env({
        source: "user_input_source",
        event_name: "user.drag_start",
        ts: NOW + 100,
        hint_tier: 1,
        dnd_override: false,
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(applyDirective).toHaveBeenCalled();

    // after 5min the dispatcher auto-returns to running.
    vi.setSystemTime(NOW + 21 + 300_000 + 1000);
    await vi.advanceTimersByTimeAsync(20);
    expect(g.cooldownActive()).toBe(false);
    expect(d.state()).toBe("running");
    d.stop();
  });
});

describe("dispatcher — degraded state (3 consecutive backend call failures)", () => {
  /** non-user tier2 firing (idle_watcher, no dnd_override) — suppressed while degraded. */
  function nonUserEnv(over: Partial<BusEnvelope> = {}): BusEnvelope {
    return {
      source: "idle_watcher",
      event_name: "idle.short",
      ts: NOW,
      hint_tier: 2,
      dnd_override: false,
      ...over,
    };
  }

  /** drives one non-user backend call to resolution with the given result. */
  async function runOneCall(idx: number, ts: number, result: BackendCallResult) {
    bus.push(nonUserEnv({ ts }));
    await vi.advanceTimersByTimeAsync(20);
    callDeferred[idx].resolve(result);
    await vi.advanceTimersByTimeAsync(20);
  }

  it("stays out of degraded after only 2 consecutive failures", async () => {
    dispatcher.start();
    await runOneCall(0, NOW, { ok: false, drop_reason: "network_drop" });
    await runOneCall(1, NOW + 1, { ok: false, drop_reason: "network_drop" });
    expect(dispatcher.state()).not.toBe("degraded");
  });

  it("enters degraded on the 3rd consecutive backend call failure", async () => {
    dispatcher.start();
    await runOneCall(0, NOW, { ok: false, drop_reason: "network_drop" });
    await runOneCall(1, NOW + 1, { ok: false, drop_reason: "network_drop" });
    await runOneCall(2, NOW + 2, { ok: false, drop_reason: "network_drop" });
    expect(dispatcher.state()).toBe("degraded");
  });

  it("a successful call resets the consecutive-failure counter", async () => {
    dispatcher.start();
    await runOneCall(0, NOW, { ok: false, drop_reason: "network_drop" });
    await runOneCall(1, NOW + 1, { ok: true });
    await runOneCall(2, NOW + 2, { ok: false, drop_reason: "network_drop" });
    await runOneCall(3, NOW + 3, { ok: false, drop_reason: "network_drop" });
    // only 2 consecutive failures since the reset — not yet degraded.
    expect(dispatcher.state()).not.toBe("degraded");
  });

  it("superseded_by_user outcomes do not count toward the consecutive-failure threshold", async () => {
    dispatcher.start();
    await runOneCall(0, NOW, { ok: false, drop_reason: "network_drop" });
    await runOneCall(1, NOW + 1, { ok: false, drop_reason: "superseded_by_user" });
    await runOneCall(2, NOW + 2, { ok: false, drop_reason: "network_drop" });
    // 2 real failures + 1 excluded supersede — not degraded.
    expect(dispatcher.state()).not.toBe("degraded");
  });

  it("while degraded, a non-user tier2/3 event is dropped as degraded_drop without reaching backendCaller", async () => {
    dispatcher.start();
    await runOneCall(0, NOW, { ok: false, drop_reason: "network_drop" });
    await runOneCall(1, NOW + 1, { ok: false, drop_reason: "network_drop" });
    await runOneCall(2, NOW + 2, { ok: false, drop_reason: "network_drop" });
    expect(dispatcher.state()).toBe("degraded");

    const callsBefore = (backendCaller.call as ReturnType<typeof vi.fn>).mock.calls.length;
    bus.push(nonUserEnv({ ts: NOW + 100 }));
    await vi.advanceTimersByTimeAsync(20);
    expect((backendCaller.call as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);
    expect(dispatcher.recentDrops(5).some((d) => d.reason === "degraded_drop")).toBe(true);
  });

  it("while degraded, user.text_submitted still reaches backendCaller (judgment stays with the backend)", async () => {
    dispatcher.start();
    await runOneCall(0, NOW, { ok: false, drop_reason: "network_drop" });
    await runOneCall(1, NOW + 1, { ok: false, drop_reason: "network_drop" });
    await runOneCall(2, NOW + 2, { ok: false, drop_reason: "network_drop" });
    expect(dispatcher.state()).toBe("degraded");

    const callsBefore = (backendCaller.call as ReturnType<typeof vi.fn>).mock.calls.length;
    bus.push(env({ ts: NOW + 100 })); // user.text_submitted, dnd_override: true
    await vi.advanceTimersByTimeAsync(20);
    expect((backendCaller.call as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      callsBefore + 1,
    );
  });

  it("exits degraded back to running on the first successful backend call", async () => {
    dispatcher.start();
    await runOneCall(0, NOW, { ok: false, drop_reason: "network_drop" });
    await runOneCall(1, NOW + 1, { ok: false, drop_reason: "network_drop" });
    await runOneCall(2, NOW + 2, { ok: false, drop_reason: "network_drop" });
    expect(dispatcher.state()).toBe("degraded");

    bus.push(env({ ts: NOW + 100 })); // user turn still goes through while degraded
    await vi.advanceTimersByTimeAsync(20);
    const idx = callDeferred.length - 1;
    callDeferred[idx].resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(20);
    expect(dispatcher.state()).toBe("running");
  });

  it("tier1 events still render locally while degraded", async () => {
    dispatcher.start();
    await runOneCall(0, NOW, { ok: false, drop_reason: "network_drop" });
    await runOneCall(1, NOW + 1, { ok: false, drop_reason: "network_drop" });
    await runOneCall(2, NOW + 2, { ok: false, drop_reason: "network_drop" });
    expect(dispatcher.state()).toBe("degraded");

    applyDirective.mockClear();
    bus.push(env({ event_name: "user.drag_start", hint_tier: 1, ts: NOW + 100 }));
    await vi.advanceTimersByTimeAsync(20);
    expect(applyDirective).toHaveBeenCalled();
  });
});
