/**
 * dispatcher.degraded.test.ts — degraded state after 3 consecutive backend call failures.
 *
 * Scope:
 *  - Entering/exiting 'degraded' on consecutive backend_caller failures/successes.
 *  - While degraded: non-user tier2/3 is dropped (degraded_drop), user turns still reach
 *    backend_caller (judgment stays with the backend), and tier1 keeps rendering locally.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PeekConfig, TapConfig } from "../config/load";
import type { Logger } from "../logger";
import type { BackendCaller, TurnOutcome } from "./backend-caller";
import { createDispatcher, type Dispatcher } from "./dispatcher";
import { type BusEnvelope, createEventBus, type EventBus } from "./event-bus";
import { createGuardrails, type Guardrails } from "./guardrails";
import {
  type DeferredCall,
  env,
  makeDeferredBackendCaller,
  makeLogger,
  NOW,
  permissiveGuardrailsConfig,
} from "./test-helpers";
import { createTurnLog, type TurnLog } from "./turn";

const PEEK_CONFIG: PeekConfig = {
  side_out_frac: 0.28,
  side_in_frac: 0.23,
  inset_frac: 0.12,
  mirror_side: "right",
};

const TAP_CONFIG: TapConfig = {
  spam_count: 4,
  spam_window_ms: 3_000,
  region_radius_frac: 0.18,
  region_motions: { head: "head_pat", chest: "embarrassed", hips: "embarrassed" },
  bored_cue: { label: "bored poking", context: "The user is poking repeatedly." },
  touch_cue_cooldown_ms: 60_000,
  touch_emotion_hold_ms: 4_000,
  pat_hold_ms: 300,
};

let bus: EventBus;
let applyDirective: ReturnType<typeof vi.fn>;
let setPerchTarget: ReturnType<typeof vi.fn>;
let setPeekTarget: ReturnType<typeof vi.fn>;
let setMotionMirror: ReturnType<typeof vi.fn>;
let easeEmotionToNeutral: ReturnType<typeof vi.fn>;
let renderer: {
  applyDirective: typeof applyDirective;
  setPerchTarget: typeof setPerchTarget;
  setPeekTarget: typeof setPeekTarget;
  setMotionMirror: typeof setMotionMirror;
  easeEmotionToNeutral: typeof easeEmotionToNeutral;
};
let peekEnter: ReturnType<typeof vi.fn<() => Promise<void>>>;
let peekExit: ReturnType<typeof vi.fn<() => Promise<void>>>;
let callDeferred: DeferredCall[];
let backendCaller: BackendCaller;
let guardrails: Guardrails;
let dispatcher: Dispatcher;
let logger: Logger;
let turnLog: TurnLog;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  bus = createEventBus();
  applyDirective = vi.fn();
  setPerchTarget = vi.fn();
  setPeekTarget = vi.fn();
  setMotionMirror = vi.fn();
  easeEmotionToNeutral = vi.fn();
  peekEnter = vi.fn().mockResolvedValue(undefined);
  peekExit = vi.fn().mockResolvedValue(undefined);
  renderer = {
    applyDirective,
    setPerchTarget,
    setPeekTarget,
    setMotionMirror,
    easeEmotionToNeutral,
  };
  callDeferred = [];
  backendCaller = makeDeferredBackendCaller(callDeferred);
  guardrails = createGuardrails(permissiveGuardrailsConfig(), { now: () => Date.now() });
  logger = makeLogger();
  turnLog = createTurnLog();
  const deps = {
    bus,
    renderer: renderer as never,
    backendCaller,
    guardrails,
    turnLog,
    hasOutstandingSpeech: () => false,
    peek: { enter: peekEnter, exit: peekExit },
    logger,
    peekConfig: () => PEEK_CONFIG,
    tapConfig: () => TAP_CONFIG,
  };
  dispatcher = createDispatcher(deps);
});
afterEach(() => {
  dispatcher.stop();
  vi.useRealTimers();
});

describe("dispatcher — degraded state (3 consecutive backend call failures)", () => {
  /** non-user tier2 firing (os_event_watcher, no dnd_override) — suppressed while degraded. */
  function nonUserEnv(over: Partial<BusEnvelope> = {}): BusEnvelope {
    return {
      source: "os_event_watcher",
      event_name: "proactive.tap_bored",
      ts: NOW,
      hint_tier: 2,
      dnd_override: false,
      ...over,
    };
  }

  /** drives one non-user backend call to resolution with the given result. */
  async function runOneCall(idx: number, ts: number, result: TurnOutcome) {
    bus.push(nonUserEnv({ ts }));
    await vi.advanceTimersByTimeAsync(20);
    callDeferred[idx].resolve(result);
    await vi.advanceTimersByTimeAsync(20);
  }

  it("stays out of degraded after only 2 consecutive failures", async () => {
    dispatcher.start();
    await runOneCall(0, NOW, "network_drop");
    await runOneCall(1, NOW + 1, "network_drop");
    expect(dispatcher.state()).not.toBe("degraded");
  });

  it("enters degraded on the 3rd consecutive backend call failure", async () => {
    dispatcher.start();
    await runOneCall(0, NOW, "network_drop");
    await runOneCall(1, NOW + 1, "network_drop");
    await runOneCall(2, NOW + 2, "network_drop");
    expect(dispatcher.state()).toBe("degraded");
  });

  it("a successful call resets the consecutive-failure counter", async () => {
    dispatcher.start();
    await runOneCall(0, NOW, "network_drop");
    await runOneCall(1, NOW + 1, "ok");
    await runOneCall(2, NOW + 2, "network_drop");
    await runOneCall(3, NOW + 3, "network_drop");
    // only 2 consecutive failures since the reset — not yet degraded.
    expect(dispatcher.state()).not.toBe("degraded");
  });

  it("superseded_by_user outcomes do not count toward the consecutive-failure threshold", async () => {
    dispatcher.start();
    await runOneCall(0, NOW, "network_drop");
    await runOneCall(1, NOW + 1, "superseded_by_user");
    await runOneCall(2, NOW + 2, "network_drop");
    // 2 real failures + 1 excluded supersede — not degraded.
    expect(dispatcher.state()).not.toBe("degraded");
  });

  it("while degraded, a non-user tier2/3 event is dropped as degraded_drop without reaching backendCaller", async () => {
    dispatcher.start();
    await runOneCall(0, NOW, "network_drop");
    await runOneCall(1, NOW + 1, "network_drop");
    await runOneCall(2, NOW + 2, "network_drop");
    expect(dispatcher.state()).toBe("degraded");

    const callsBefore = (backendCaller.call as ReturnType<typeof vi.fn>).mock.calls.length;
    bus.push(nonUserEnv({ ts: NOW + 100 }));
    await vi.advanceTimersByTimeAsync(20);
    expect((backendCaller.call as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);
    expect(dispatcher.recentDrops(5).some((d) => d.reason === "degraded_drop")).toBe(true);
  });

  it("while degraded, user.text_submitted still reaches backendCaller (judgment stays with the backend)", async () => {
    dispatcher.start();
    await runOneCall(0, NOW, "network_drop");
    await runOneCall(1, NOW + 1, "network_drop");
    await runOneCall(2, NOW + 2, "network_drop");
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
    await runOneCall(0, NOW, "network_drop");
    await runOneCall(1, NOW + 1, "network_drop");
    await runOneCall(2, NOW + 2, "network_drop");
    expect(dispatcher.state()).toBe("degraded");

    bus.push(env({ ts: NOW + 100 })); // user turn still goes through while degraded
    await vi.advanceTimersByTimeAsync(20);
    const idx = callDeferred.length - 1;
    callDeferred[idx].resolve("ok");
    await vi.advanceTimersByTimeAsync(20);
    expect(dispatcher.state()).toBe("running");
  });

  it("tier1 events still render locally while degraded", async () => {
    dispatcher.start();
    await runOneCall(0, NOW, "network_drop");
    await runOneCall(1, NOW + 1, "network_drop");
    await runOneCall(2, NOW + 2, "network_drop");
    expect(dispatcher.state()).toBe("degraded");

    applyDirective.mockClear();
    bus.push(env({ event_name: "user.drag_start", hint_tier: 1, ts: NOW + 100 }));
    await vi.advanceTimersByTimeAsync(20);
    expect(applyDirective).toHaveBeenCalled();
  });
});
