/**
 * dispatcher.routing.test.ts — classify → route (§5.1) and tap/pat emotion revert timing.
 *
 * Scope:
 *  - §5.1 classify: user.text_submitted (tier2) → backend_caller; user.drag_* / user.tap
 *    (tier1 half) → tier1/renderer.
 *  - Tap/pat emotion revert timing (touch_emotion_hold_ms).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PeekConfig, TapConfig } from "../config/load";
import type { Logger } from "../logger";
import type { BackendCaller } from "./backend-caller";
import { createDispatcher, type Dispatcher } from "./dispatcher";
import { createEventBus, type EventBus } from "./event-bus";
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
let speaking: boolean;

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

  it("user.tap is observability-only and leaves the current motion untouched", async () => {
    dispatcher.start();
    bus.push(env({ event_name: "user.tap", hint_tier: 1 }));
    await vi.advanceTimersByTimeAsync(20);
    expect(applyDirective).not.toHaveBeenCalled();
    expect(backendCaller.call as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("routes user.tap_region (tier1) to the payload motion", async () => {
    dispatcher.start();
    bus.push(
      env({
        source: "os_event_watcher",
        event_name: "user.tap_region",
        hint_tier: 1,
        payload: { motion_id: "embarrassed" },
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(applyDirective).toHaveBeenCalledWith({
      speech_text: "",
      motion: { id: "embarrassed" },
    });
    expect(backendCaller.call as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("routes user.pat_start (tier1) to the payload motion + emotion", async () => {
    dispatcher.start();
    bus.push(
      env({
        source: "os_event_watcher",
        event_name: "user.pat_start",
        hint_tier: 1,
        payload: { motion_id: "head_pat", emotion_id: "relaxed" },
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(applyDirective).toHaveBeenCalledWith({
      speech_text: "",
      motion: { id: "head_pat" },
      emotion: { id: "relaxed" },
    });
    expect(backendCaller.call as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("routes user.pat_end (tier1) back to idle", async () => {
    dispatcher.start();
    bus.push(env({ source: "os_event_watcher", event_name: "user.pat_end", hint_tier: 1 }));
    await vi.advanceTimersByTimeAsync(20);
    expect(applyDirective).toHaveBeenCalledWith({ speech_text: "", motion: null });
    expect(backendCaller.call as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("does not classify removed user.tap_spam events", async () => {
    dispatcher.start();
    bus.push(
      env({
        source: "os_event_watcher",
        event_name: "user.tap_spam",
        hint_tier: 1,
        payload: { motion_id: "sulk" },
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(applyDirective).not.toHaveBeenCalled();
    expect(backendCaller.call as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    {},
    { motion_id: "" },
    { motion_id: 7 },
  ])("drops malformed tap motion payload %j with a warning", async (payload) => {
    dispatcher.start();
    bus.push(
      env({
        source: "os_event_watcher",
        event_name: "user.tap_region",
        hint_tier: 1,
        payload,
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(applyDirective).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("routes user.tap_region with emotion_id to the payload motion + emotion", async () => {
    dispatcher.start();
    bus.push(
      env({
        source: "os_event_watcher",
        event_name: "user.tap_region",
        hint_tier: 1,
        payload: { motion_id: "embarrassed", emotion_id: "embarrassed" },
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(applyDirective).toHaveBeenCalledWith({
      speech_text: "",
      motion: { id: "embarrassed" },
      emotion: { id: "embarrassed" },
    });
    expect(backendCaller.call as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it.each([
    "",
    7,
  ])("degrades malformed tap emotion_id %j to a motion-only directive", async (emotionId) => {
    dispatcher.start();
    bus.push(
      env({
        source: "os_event_watcher",
        event_name: "user.tap_region",
        hint_tier: 1,
        payload: { motion_id: "embarrassed", emotion_id: emotionId },
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(applyDirective).toHaveBeenCalledWith({
      speech_text: "",
      motion: { id: "embarrassed" },
    });
  });

  it("routes proactive.tap_bored (tier2) to the backend caller", async () => {
    dispatcher.start();
    bus.push(
      env({
        source: "os_event_watcher",
        event_name: "proactive.tap_bored",
        hint_tier: 2,
        dnd_override: false,
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(backendCaller.call as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
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

  it("configures a valid peek drop before routing its tier1 directive", async () => {
    dispatcher.start();
    bus.push(
      env({
        event_name: "user.peek_drop",
        hint_tier: 1,
        payload: { side: "right", target_local_xpx: 240 },
      }),
    );
    await vi.advanceTimersByTimeAsync(20);

    expect(backendCaller.call as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(setPerchTarget).toHaveBeenCalledWith(null);
    expect(setMotionMirror).toHaveBeenCalledWith(true);
    expect(setPeekTarget).toHaveBeenCalledWith({ targetXpx: 240 });
    expect(peekEnter).toHaveBeenCalledTimes(1);
    expect(applyDirective).toHaveBeenLastCalledWith({ speech_text: "", motion: { id: "peek" } });
    expect(setPerchTarget.mock.invocationCallOrder[0]).toBeLessThan(
      setMotionMirror.mock.invocationCallOrder[0],
    );
    expect(setMotionMirror.mock.invocationCallOrder[0]).toBeLessThan(
      setPeekTarget.mock.invocationCallOrder[0],
    );
    expect(setPeekTarget.mock.invocationCallOrder[0]).toBeLessThan(
      applyDirective.mock.invocationCallOrder[0],
    );

    bus.push(env({ event_name: "user.peek_exit", hint_tier: 1 }));
    await vi.advanceTimersByTimeAsync(20);
    expect(peekExit).toHaveBeenCalledTimes(1);
    expect(setPeekTarget).toHaveBeenLastCalledWith(null);
    expect(setMotionMirror).toHaveBeenLastCalledWith(false);
    expect(applyDirective).toHaveBeenLastCalledWith({ speech_text: "", motion: null });
  });

  it("mirrors only the configured peek side", async () => {
    dispatcher.start();
    bus.push(
      env({
        event_name: "user.peek_drop",
        hint_tier: 1,
        payload: { side: "left", target_local_xpx: 80 },
      }),
    );
    await vi.advanceTimersByTimeAsync(20);

    expect(setMotionMirror).toHaveBeenCalledWith(false);
    expect(setPeekTarget).toHaveBeenCalledWith({ targetXpx: 80 });
  });

  it("reads the configured mirror side when each peek drop is handled", async () => {
    let livePeekConfig = PEEK_CONFIG;
    dispatcher.stop();
    dispatcher = createDispatcher({
      bus,
      renderer: renderer as never,
      backendCaller,
      guardrails,
      turnLog,
      hasOutstandingSpeech: () => speaking,
      logger,
      peekConfig: () => livePeekConfig,
      tapConfig: () => TAP_CONFIG,
    });
    dispatcher.start();
    livePeekConfig = { ...PEEK_CONFIG, mirror_side: "left" };

    bus.push(
      env({
        event_name: "user.peek_drop",
        hint_tier: 1,
        payload: { side: "left", target_local_xpx: 80 },
      }),
    );
    await vi.advanceTimersByTimeAsync(20);

    expect(setMotionMirror).toHaveBeenCalledWith(true);
  });

  it.each([
    undefined,
    {},
    { side: "left" },
    { side: "right", target_local_xpx: Number.NaN },
    { side: "right", target_local_xpx: Number.POSITIVE_INFINITY },
    { side: "top", target_local_xpx: 20 },
  ])("aborts malformed peek drop payload %j without any side effects", async (payload) => {
    dispatcher.start();
    bus.push(env({ event_name: "user.peek_drop", hint_tier: 1, payload }));
    await vi.advanceTimersByTimeAsync(20);

    expect(logger.warn).toHaveBeenCalledWith(
      "peek_drop.malformed",
      expect.objectContaining({ payload }),
    );
    expect(setPerchTarget).not.toHaveBeenCalled();
    expect(setMotionMirror).not.toHaveBeenCalled();
    expect(setPeekTarget).not.toHaveBeenCalled();
    expect(peekEnter).not.toHaveBeenCalled();
    expect(applyDirective).not.toHaveBeenCalled();
    expect(dispatcher.getPosture()).toEqual({ state: "standing" });
  });

  it.each([
    ["user.peek_exit", undefined],
    ["user.drag_start", undefined],
    ["user.window_sit_enter", undefined],
    ["user.window_sit_exit", undefined],
    ["user.window_sit_drop", { edge_local_ypx: 30 }],
  ] as const)("clears the peek target and mirror on %s", async (event_name, payload) => {
    dispatcher.start();
    bus.push(env({ event_name, hint_tier: 1, payload }));
    await vi.advanceTimersByTimeAsync(20);

    expect(setPeekTarget).toHaveBeenCalledWith(null);
    expect(setMotionMirror).toHaveBeenCalledWith(false);
  });

  it("clears the peek pin before setting the perch pin on peek-to-sit transition", async () => {
    dispatcher.start();
    bus.push(
      env({
        event_name: "user.window_sit_drop",
        hint_tier: 1,
        payload: { edge_local_ypx: 30 },
      }),
    );
    await vi.advanceTimersByTimeAsync(20);

    expect(setPeekTarget.mock.invocationCallOrder[0]).toBeLessThan(
      setPerchTarget.mock.invocationCallOrder[0],
    );
  });

  it("exits peek for drag and either sit entry path", async () => {
    dispatcher.start();
    for (const event_name of ["user.drag_start", "user.window_sit_enter", "user.window_sit_drop"]) {
      bus.push(
        env({
          event_name,
          hint_tier: 1,
          payload: event_name === "user.window_sit_drop" ? { edge_local_ypx: 30 } : undefined,
        }),
      );
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(peekExit).toHaveBeenCalledTimes(3);
  });

  it("keeps peek events renderable when the optional side-channel is absent", async () => {
    dispatcher.stop();
    dispatcher = createDispatcher({
      bus,
      renderer: renderer as never,
      peekConfig: () => PEEK_CONFIG,
      tapConfig: () => TAP_CONFIG,
      backendCaller,
      guardrails,
      turnLog,
      hasOutstandingSpeech: () => speaking,
      logger,
    });
    dispatcher.start();
    bus.push(
      env({
        event_name: "user.peek_drop",
        hint_tier: 1,
        payload: { side: "left", target_local_xpx: 80 },
      }),
    );
    bus.push(env({ event_name: "user.peek_exit", hint_tier: 1, ts: NOW + 1 }));
    await vi.advanceTimersByTimeAsync(40);
    expect(applyDirective).toHaveBeenCalledTimes(2);
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

  it("routes signals.batch as tier2 to backend_caller", async () => {
    dispatcher.start();
    bus.push(
      env({
        source: "timer_scheduler",
        event_name: "signals.batch",
        ts: NOW,
        dnd_override: false,
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(backendCaller.call as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      "fire",
      expect.objectContaining({ event_name: "signals.batch", tier: 2 }),
    );
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

  it("aborts a malformed window sit drop without setting posture", async () => {
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
    expect(logger.warn).toHaveBeenCalledWith(
      "perch_target.malformed",
      expect.objectContaining({ payload: {} }),
    );
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(setPerchTarget).not.toHaveBeenCalled();
    expect(applyDirective).not.toHaveBeenCalled();
    expect(dispatcher.getPosture()).toEqual({ state: "standing" });
  });
});

describe("dispatcher — tap emotion revert (touch_emotion_hold_ms)", () => {
  function pushEmotionTap(ts = NOW): void {
    bus.push(
      env({
        source: "os_event_watcher",
        event_name: "user.tap_region",
        hint_tier: 1,
        ts,
        payload: { motion_id: "embarrassed", emotion_id: "embarrassed" },
      }),
    );
  }

  it("eases the tap emotion back to neutral after touch_emotion_hold_ms", async () => {
    dispatcher.start();
    pushEmotionTap();
    await vi.advanceTimersByTimeAsync(20);
    expect(applyDirective).toHaveBeenCalledTimes(1);
    expect(easeEmotionToNeutral).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(TAP_CONFIG.touch_emotion_hold_ms);
    expect(easeEmotionToNeutral).toHaveBeenCalledTimes(1);
  });

  it("replaces the pending revert on a second emotion tap instead of stacking", async () => {
    dispatcher.start();
    pushEmotionTap();
    await vi.advanceTimersByTimeAsync(20);
    pushEmotionTap(NOW + 20);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(easeEmotionToNeutral).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(TAP_CONFIG.touch_emotion_hold_ms);
    expect(easeEmotionToNeutral).toHaveBeenCalledTimes(1);
  });

  it("holds the pat emotion until the release, then eases it back after touch_emotion_hold_ms", async () => {
    dispatcher.start();
    bus.push(
      env({
        source: "os_event_watcher",
        event_name: "user.pat_start",
        hint_tier: 1,
        payload: { motion_id: "head_pat", emotion_id: "relaxed" },
      }),
    );
    await vi.advanceTimersByTimeAsync(20 + TAP_CONFIG.touch_emotion_hold_ms * 2);
    expect(easeEmotionToNeutral).not.toHaveBeenCalled();

    bus.push(
      env({
        source: "os_event_watcher",
        event_name: "user.pat_end",
        hint_tier: 1,
        ts: NOW + 1,
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(easeEmotionToNeutral).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(TAP_CONFIG.touch_emotion_hold_ms);
    expect(easeEmotionToNeutral).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending tap revert when a pat starts inside the hold window", async () => {
    dispatcher.start();
    pushEmotionTap();
    await vi.advanceTimersByTimeAsync(20);
    bus.push(
      env({
        source: "os_event_watcher",
        event_name: "user.pat_start",
        hint_tier: 1,
        ts: NOW + 20,
        payload: { motion_id: "head_pat", emotion_id: "relaxed" },
      }),
    );
    await vi.advanceTimersByTimeAsync(20 + TAP_CONFIG.touch_emotion_hold_ms * 2);
    expect(easeEmotionToNeutral).not.toHaveBeenCalled();
  });

  it("schedules no revert on release when the pat applied no emotion", async () => {
    dispatcher.start();
    bus.push(
      env({
        source: "os_event_watcher",
        event_name: "user.pat_start",
        hint_tier: 1,
        payload: { motion_id: "head_pat" },
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    bus.push(
      env({
        source: "os_event_watcher",
        event_name: "user.pat_end",
        hint_tier: 1,
        ts: NOW + 20,
      }),
    );
    await vi.advanceTimersByTimeAsync(20 + TAP_CONFIG.touch_emotion_hold_ms * 2);
    expect(applyDirective).toHaveBeenCalledTimes(2);
    expect(easeEmotionToNeutral).not.toHaveBeenCalled();
  });

  it("schedules no revert for a release that follows no pat", async () => {
    dispatcher.start();
    bus.push(env({ source: "os_event_watcher", event_name: "user.pat_end", hint_tier: 1 }));
    await vi.advanceTimersByTimeAsync(20 + TAP_CONFIG.touch_emotion_hold_ms * 2);
    expect(easeEmotionToNeutral).not.toHaveBeenCalled();
  });

  it("schedules no revert for a motion-only tap_region", async () => {
    dispatcher.start();
    bus.push(
      env({
        source: "os_event_watcher",
        event_name: "user.tap_region",
        hint_tier: 1,
        payload: { motion_id: "embarrassed" },
      }),
    );
    await vi.advanceTimersByTimeAsync(20 + TAP_CONFIG.touch_emotion_hold_ms * 2);
    expect(applyDirective).toHaveBeenCalledTimes(1);
    expect(easeEmotionToNeutral).not.toHaveBeenCalled();
  });

  it("stop() clears a pending revert", async () => {
    dispatcher.start();
    pushEmotionTap();
    await vi.advanceTimersByTimeAsync(20);
    dispatcher.stop();
    await vi.advanceTimersByTimeAsync(TAP_CONFIG.touch_emotion_hold_ms * 2);
    expect(easeEmotionToNeutral).not.toHaveBeenCalled();
  });

  it("skips the revert and does not reschedule when speech is playing at fire time", async () => {
    dispatcher.start();
    pushEmotionTap();
    await vi.advanceTimersByTimeAsync(20);
    setSpeaking(true);
    expect(turnLog.current()).toBeNull();
    await vi.advanceTimersByTimeAsync(TAP_CONFIG.touch_emotion_hold_ms);
    expect(easeEmotionToNeutral).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(TAP_CONFIG.touch_emotion_hold_ms * 2);
    expect(easeEmotionToNeutral).not.toHaveBeenCalled();
  });

  it("fires while a silent backend call is in flight (regression: speech owed, not !isOver)", async () => {
    dispatcher.start();
    pushEmotionTap();
    await vi.advanceTimersByTimeAsync(20);
    // a second, silent backend call is admitted and never settles — the ledger is not over,
    // but nothing is owed, so the revert must still fire.
    bus.push(
      env({
        source: "os_event_watcher",
        event_name: "proactive.tap_bored",
        hint_tier: 2,
        dnd_override: false,
        ts: NOW + 1,
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(dispatcher.inFlight()).not.toBeNull();

    await vi.advanceTimersByTimeAsync(TAP_CONFIG.touch_emotion_hold_ms);
    expect(easeEmotionToNeutral).toHaveBeenCalledTimes(1);
  });
});
