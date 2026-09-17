/**
 * dispatcher.logging.test.ts — structured logging and the turn-outcome notification seams.
 *
 * Scope:
 *  - logger.info('state_change'/'fire'/'drop'/'turn') and logger.debug('backend_call').
 *  - The onUserTurnFailed and onTurnFailed seams that notify a failed turn's outcome to a
 *    listener outside the dispatcher.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PeekConfig, TapConfig } from "../config/load";
import type { Logger } from "../logger";
import type { BackendCaller } from "./backend-caller";
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
import { createTurnLog, type Turn, type TurnLog } from "./turn";

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
let speaking: boolean;

/**
 * Simulates "audio is still playing" the way the speech pipeline does: it answers the dispatcher
 * directly, and reports to the ledger as well — where a turn with none current is ignored.
 */
function setSpeaking(owed: boolean): void {
  speaking = owed;
  turnLog.setAudioOwed(owed);
}

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
  speaking = false;
  const deps = {
    bus,
    renderer: renderer as never,
    backendCaller,
    guardrails,
    turnLog,
    hasOutstandingSpeech: () => speaking,
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

  it("emits logger.info('fire', {seq_id}) for a tier1 window_sit_enter", async () => {
    dispatcher.start();
    bus.push(
      env({
        source: "os_event_watcher",
        event_name: "user.window_sit_enter",
        hint_tier: 1,
        dnd_override: false,
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(logger.info).toHaveBeenCalledWith(
      "fire",
      expect.objectContaining({
        event_name: "user.window_sit_enter",
        seq_id: expect.anything(),
      }),
    );
  });
});

describe("dispatcher — structured logging: backend_call events", () => {
  it("emits logger.debug('backend_call', {trigger, seq_id, started_at}) at call start", async () => {
    dispatcher.start();
    bus.push(env());
    await vi.advanceTimersByTimeAsync(20);
    expect(logger.debug).toHaveBeenCalledWith(
      "backend_call",
      expect.objectContaining({ seq_id: expect.anything(), started_at: expect.any(Number) }),
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
      peekConfig: () => PEEK_CONFIG,
      tapConfig: () => TAP_CONFIG,
      backendCaller,
      guardrails,
      turnLog,
      hasOutstandingSpeech: () => speaking,
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
    callDeferred[0].resolve("network_drop");
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
    callDeferred[0].resolve("parse_error");
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
    callDeferred[0].resolve("http_4xx_drop");
    await vi.advanceTimersByTimeAsync(20);
    expect(sink).toHaveBeenCalledWith("http_4xx_drop", "text");
    d.stop();
  });

  it("does NOT fire for a non-user-initiated trigger (proactive.tap_bored), even on failure", async () => {
    const { d, sink } = makeDispatcherWithFailedTurnSink();
    d.start();
    bus.push(
      env({
        event_name: "proactive.tap_bored",
        dnd_override: undefined,
        source: "os_event_watcher",
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    callDeferred[0].resolve("network_drop");
    await vi.advanceTimersByTimeAsync(20);
    expect(sink).not.toHaveBeenCalled();
    d.stop();
  });

  // A proactive/schedule turn failing must never reach speakFailure — bootstrap-configured.ts
  // calls voice.speakFailure(reason) unconditionally from this same sink, and nothing there
  // re-checks the trigger kind, so the gate has to hold here.
  it("does NOT fire for a proactive turn (window_sit), even on failure — speakFailure must never see it", async () => {
    const { d, sink } = makeDispatcherWithFailedTurnSink();
    d.start();
    bus.push(
      env({
        event_name: "proactive.window_sit",
        dnd_override: undefined,
        source: "timer_scheduler",
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    callDeferred[0].resolve("network_stall");
    await vi.advanceTimersByTimeAsync(20);
    expect(sink).not.toHaveBeenCalled();
    d.stop();
  });

  it("does NOT fire for a schedule turn (daily_checkin), even on failure — speakFailure must never see it", async () => {
    const { d, sink } = makeDispatcherWithFailedTurnSink();
    d.start();
    bus.push(
      env({
        event_name: "schedule.daily_checkin",
        dnd_override: undefined,
        source: "timer_scheduler",
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    callDeferred[0].resolve("network_drop");
    await vi.advanceTimersByTimeAsync(20);
    expect(sink).not.toHaveBeenCalled();
    d.stop();
  });

  it("does NOT fire when the outcome is superseded_by_user", async () => {
    const { d, sink } = makeDispatcherWithFailedTurnSink();
    d.start();
    bus.push(env({ event_name: "user.text_submitted" }));
    await vi.advanceTimersByTimeAsync(20);
    callDeferred[0].resolve("superseded_by_user");
    await vi.advanceTimersByTimeAsync(20);
    expect(sink).not.toHaveBeenCalled();
    d.stop();
  });

  it("does NOT fire on a successful user turn", async () => {
    const { d, sink } = makeDispatcherWithFailedTurnSink();
    d.start();
    bus.push(env({ event_name: "user.text_submitted" }));
    await vi.advanceTimersByTimeAsync(20);
    callDeferred[0].resolve("ok");
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
    callDeferred[0].resolve("parse_error");
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
    callDeferred[0].resolve("network_drop");
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
        source: "os_event_watcher",
        event_name: "proactive.tap_bored",
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
        source: "os_event_watcher",
        event_name: "proactive.tap_bored",
        ts: NOW + 1,
        hint_tier: 2,
        dnd_override: false,
      }),
    );
    bus.push(
      env({
        source: "os_event_watcher",
        event_name: "proactive.drag_held",
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

describe("dispatcher — structured logging: turn events", () => {
  function turnLines(): Array<[string, Record<string, unknown>]> {
    return (logger.info as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === "turn",
    ) as Array<[string, Record<string, unknown>]>;
  }

  it("emits exactly one turn line for a successful turn that owes no audio", async () => {
    dispatcher.start();
    bus.push(env());
    await vi.advanceTimersByTimeAsync(20);
    const id = turnLog.current()!.id;
    callDeferred[0].resolve("ok");
    await vi.advanceTimersByTimeAsync(20);

    const lines = turnLines();
    expect(lines).toHaveLength(1);
    const [, payload] = lines[0]!;
    expect(payload.id).toBe(id);
    expect(payload.outcome).toBe("ok");
    expect(payload.spoke).toBe(false);
    expect(typeof payload.duration_ms).toBe("number");
    expect(payload.duration_ms as number).toBeGreaterThanOrEqual(0);
  });

  it("a turn that owed audio: spoke:true, but the line only appears once audio drains", async () => {
    dispatcher.start();
    bus.push(env());
    await vi.advanceTimersByTimeAsync(20);
    setSpeaking(true);
    callDeferred[0].resolve("ok");
    await vi.advanceTimersByTimeAsync(20);

    expect(turnLines()).toHaveLength(0);

    setSpeaking(false);
    await vi.advanceTimersByTimeAsync(20);

    const lines = turnLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]![1].spoke).toBe(true);
  });

  it("a turn whose backend returned speech reports spoke_text:true even with TTS off", async () => {
    dispatcher.start();
    bus.push(env());
    await vi.advanceTimersByTimeAsync(20);
    // The speech gate passed, but no audio was ever owed (TTS off).
    turnLog.setSpokeText(true);
    callDeferred[0].resolve("ok");
    await vi.advanceTimersByTimeAsync(20);

    const lines = turnLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]![1].spoke_text).toBe(true);
    expect(lines[0]![1].spoke).toBe(false);
  });

  it("an empty-speech turn reports spoke_text:false", async () => {
    dispatcher.start();
    bus.push(env());
    await vi.advanceTimersByTimeAsync(20);
    turnLog.setSpokeText(false);
    callDeferred[0].resolve("ok");
    await vi.advanceTimersByTimeAsync(20);

    const lines = turnLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]![1].spoke_text).toBe(false);
  });

  it("two consecutive turns produce two turn lines with different ids", async () => {
    dispatcher.start();
    bus.push(env({ ts: NOW }));
    await vi.advanceTimersByTimeAsync(20);
    const firstId = turnLog.current()!.id;
    callDeferred[0].resolve("ok");
    await vi.advanceTimersByTimeAsync(20);

    bus.push(env({ ts: NOW + 1 }));
    await vi.advanceTimersByTimeAsync(20);
    const secondId = turnLog.current()!.id;
    callDeferred[1].resolve("ok");
    await vi.advanceTimersByTimeAsync(20);

    const lines = turnLines();
    expect(lines).toHaveLength(2);
    expect(lines[0]![1].id).toBe(firstId);
    expect(lines[1]![1].id).toBe(secondId);
    expect(secondId).toBeGreaterThan(firstId);
  });

  it("a user turn superseding an in-flight turn: the superseded turn gets a turn line before the successor starts", async () => {
    dispatcher.start();
    bus.push(env({ ts: NOW }));
    await vi.advanceTimersByTimeAsync(20);
    const firstId = turnLog.current()!.id;

    bus.push(env({ ts: NOW + 1 }));
    await vi.advanceTimersByTimeAsync(20);
    const secondId = turnLog.current()!.id;
    expect(secondId).toBeGreaterThan(firstId);

    const lines = turnLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]![1].id).toBe(firstId);
    expect(lines[0]![1].outcome).toBe("superseded_by_user");
  });

  it("no longer emits an info-level backend_call entry for a turn", async () => {
    dispatcher.start();
    bus.push(env());
    await vi.advanceTimersByTimeAsync(20);
    callDeferred[0].resolve("ok");
    await vi.advanceTimersByTimeAsync(20);

    const backendCallInfoLines = (logger.info as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === "backend_call",
    );
    expect(backendCallInfoLines).toHaveLength(0);
  });

  it("a turn displaced by supersede while owing audio reports spoke:true on its own line", async () => {
    dispatcher.start();
    bus.push(env({ ts: NOW }));
    await vi.advanceTimersByTimeAsync(20);
    const firstId = turnLog.current()!.id;

    // turn 1 owes audio and is still in flight when a second user message supersedes it.
    setSpeaking(true);
    bus.push(env({ ts: NOW + 1 }));
    await vi.advanceTimersByTimeAsync(20);

    const lines = turnLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]![1].id).toBe(firstId);
    expect(lines[0]![1].spoke).toBe(true);
  });

  it("the drain path preserves the completed turn's real outcome instead of superseded_by_user", async () => {
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

    dispatcher.start();
    bus.push(nonUserEnv({ ts: NOW }));
    await vi.advanceTimersByTimeAsync(20);
    const firstId = turnLog.current()!.id;

    // a second non-user turn defers behind the first (no supersede for non-user triggers).
    bus.push(nonUserEnv({ event_name: "proactive.drag_held", ts: NOW + 1 }));
    await vi.advanceTimersByTimeAsync(20);

    // turn 1 succeeds; the drain in .finally() starts turn 2 before turn 1 is settled.
    callDeferred[0].resolve("ok");
    await vi.advanceTimersByTimeAsync(20);

    const secondId = turnLog.current()!.id;
    expect(secondId).not.toBe(firstId);
    expect(backendCaller.call as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(2);

    const lines = turnLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]![1].id).toBe(firstId);
    expect(lines[0]![1].outcome).toBe("ok");
  });
});

describe("dispatcher — onTurnFailed seam", () => {
  function makeDispatcherWithTurnFailedSink(caller: BackendCaller = backendCaller): {
    d: Dispatcher;
    sink: ReturnType<typeof vi.fn>;
    userSink: ReturnType<typeof vi.fn>;
  } {
    const sink = vi.fn();
    const userSink = vi.fn();
    const d = createDispatcher({
      bus,
      renderer: renderer as never,
      peekConfig: () => PEEK_CONFIG,
      tapConfig: () => TAP_CONFIG,
      backendCaller: caller,
      guardrails,
      turnLog,
      hasOutstandingSpeech: () => speaking,
      logger,
      onTurnFailed: sink,
      onUserTurnFailed: userSink,
    });
    return { d, sink, userSink };
  }

  it("fires once with the failed turn and its reason", async () => {
    const { d, sink } = makeDispatcherWithTurnFailedSink();
    d.start();
    bus.push(env({ event_name: "user.text_submitted" }));
    await vi.advanceTimersByTimeAsync(20);
    callDeferred[0].resolve("network_drop");
    await vi.advanceTimersByTimeAsync(20);
    expect(sink).toHaveBeenCalledTimes(1);
    const [turn, reason] = sink.mock.calls[0];
    expect((turn as Turn).trigger.event_name).toBe("user.text_submitted");
    expect(reason).toBe("network_drop");
    d.stop();
  });

  it("fires for a proactive turn that never reaches onUserTurnFailed", async () => {
    const { d, sink, userSink } = makeDispatcherWithTurnFailedSink();
    d.start();
    bus.push(
      env({
        event_name: "proactive.tap_bored",
        dnd_override: undefined,
        source: "os_event_watcher",
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    callDeferred[0].resolve("network_stall");
    await vi.advanceTimersByTimeAsync(20);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][1]).toBe("network_stall");
    expect(userSink).not.toHaveBeenCalled();
    d.stop();
  });

  it("fires for a schedule turn that never reaches onUserTurnFailed", async () => {
    const { d, sink, userSink } = makeDispatcherWithTurnFailedSink();
    d.start();
    bus.push(
      env({
        event_name: "schedule.daily_checkin",
        dnd_override: undefined,
        source: "timer_scheduler",
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    callDeferred[0].resolve("network_drop");
    await vi.advanceTimersByTimeAsync(20);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][1]).toBe("network_drop");
    expect(userSink).not.toHaveBeenCalled();
    d.stop();
  });

  it("stays quiet on a successful turn", async () => {
    const { d, sink } = makeDispatcherWithTurnFailedSink();
    d.start();
    bus.push(env({ event_name: "user.text_submitted" }));
    await vi.advanceTimersByTimeAsync(20);
    callDeferred[0].resolve("ok");
    await vi.advanceTimersByTimeAsync(20);
    expect(sink).not.toHaveBeenCalled();
    d.stop();
  });

  it("stays quiet when the turn was superseded by the user", async () => {
    const { d, sink } = makeDispatcherWithTurnFailedSink();
    d.start();
    bus.push(env({ event_name: "user.text_submitted" }));
    await vi.advanceTimersByTimeAsync(20);
    callDeferred[0].resolve("superseded_by_user");
    await vi.advanceTimersByTimeAsync(20);
    expect(sink).not.toHaveBeenCalled();
    d.stop();
  });

  it("fires with network_drop when the call throws", async () => {
    const throwing: BackendCaller = { call: vi.fn(() => Promise.reject(new Error("boom"))) };
    const { d, sink } = makeDispatcherWithTurnFailedSink(throwing);
    d.start();
    bus.push(env({ event_name: "user.text_submitted" }));
    await vi.advanceTimersByTimeAsync(20);
    expect(sink).toHaveBeenCalledTimes(1);
    const [turn, reason] = sink.mock.calls[0];
    expect((turn as Turn).trigger.event_name).toBe("user.text_submitted");
    expect(reason).toBe("network_drop");
    d.stop();
  });
});
