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
import { ATTACHMENT_LIMITS_DEFAULTS, type PeekConfig, type TapConfig } from "../config/load";
import type { Logger } from "../logger";
import type { BackendCaller, TurnOutcome } from "./backend-caller";
import { createDispatcher, type Dispatcher, DROP_SEVERITY } from "./dispatcher";
import { type BusEnvelope, createEventBus, type EventBus } from "./event-bus";
import { createGuardrails, type Guardrails, type GuardrailsConfig } from "./guardrails";
import { createTurnLog, type Turn, type TurnLog } from "./turn";

const NOW = 1_717_000_000_000;

/**
 * Permissive guardrails config for routing/supersede testing — debounce 0, generous cap.
 * Guardrails validation itself is guardrails.test.ts responsibility, so we don't interfere here.
 */
function permissiveGuardrailsConfig(): GuardrailsConfig {
  return {
    debounce_ms: {
      idle_watcher: 0,
      os_event_watcher: 0,
      backend_push_source: 0,
      user_input_source: 0,
      screen_watcher: 5000,
    },
    rate_limit: {
      window_ms: 3_600_000,
      tier2_max: 1000,
      tier3_max: 1000,
      overall_max: 1000,
      cooldown_ms: 300_000,
    },
    attachments: ATTACHMENT_LIMITS_DEFAULTS,
  };
}

/** Guardrails config using §6 SOT values as-is (for gating testing). */
function realGuardrailsConfig(): GuardrailsConfig {
  return {
    debounce_ms: {
      idle_watcher: 30_000,
      os_event_watcher: 5_000,
      backend_push_source: 10_000,
      user_input_source: 0,
      screen_watcher: 5000,
    },
    rate_limit: {
      window_ms: 3_600_000,
      tier2_max: 6,
      tier3_max: 2,
      overall_max: 20,
      cooldown_ms: 300_000,
    },
    attachments: ATTACHMENT_LIMITS_DEFAULTS,
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
let callDeferred: Array<{ resolve: (r: TurnOutcome) => void; signal?: AbortSignal }>;
let backendCaller: BackendCaller;
let guardrails: Guardrails;
let dispatcher: Dispatcher;
let logger: Logger;
let turnLog: TurnLog;

/**
 * Simulates "audio is still playing" independent of any backend call in flight — begins a
 * throwaway turn first if none is current, since a live turn is a precondition for audio-owed
 * (matching how a reply's audio can outlive the call that produced it).
 */
function setSpeaking(owed: boolean): void {
  if (!turnLog.current()) turnLog.begin(env());
  turnLog.setAudioOwed(owed);
}

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
  region_motions: { chest: "embarrassed", hips: "embarrassed" },
  bored_cue: { label: "bored poking", context: "The user is poking repeatedly." },
  touch_cue_cooldown_ms: 60_000,
  touch_emotion_hold_ms: 4_000,
};

function makeBackendCaller(): BackendCaller {
  return {
    call: vi.fn((_turn: Turn, signal?: AbortSignal) => {
      return new Promise<TurnOutcome>((resolve) => {
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
  backendCaller = makeBackendCaller();
  guardrails = createGuardrails(permissiveGuardrailsConfig(), { now: () => Date.now() });
  logger = makeLogger();
  turnLog = createTurnLog();
  const deps = {
    bus,
    renderer: renderer as never,
    backendCaller,
    guardrails,
    turnLog,
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

describe("dispatcher — state machine (§9)", () => {
  it("starts booting, becomes running after start()", () => {
    expect(dispatcher.state()).toBe("booting");
    dispatcher.start();
    expect(dispatcher.state()).toBe("running");
  });

  it("start() called again from cooldown does not stack a second pump interval", async () => {
    const cfg = realGuardrailsConfig();
    cfg.rate_limit.tier2_max = 1000;
    const g = createGuardrails(cfg, { now: () => Date.now() });
    const d = createDispatcher({
      bus,
      renderer: renderer as never,
      peekConfig: () => PEEK_CONFIG,
      tapConfig: () => TAP_CONFIG,
      backendCaller,
      guardrails: g,
      turnLog,
      logger,
    });
    d.start();
    // exceed rate_limit.overall_max to force cooldown.
    for (let i = 0; i < 21; i++) {
      g.evaluate(
        env({
          source: "user_input_source",
          event_name: "user.text_submitted",
          ts: NOW + i,
          dnd_override: false,
        }),
        2,
      );
    }
    // let the running pump interval observe cooldownActive() and sync state.
    await vi.advanceTimersByTimeAsync(20);
    expect(d.state()).toBe("cooldown");

    const timerCountBeforeRestart = vi.getTimerCount();
    d.start();
    expect(vi.getTimerCount()).toBe(timerCountBeforeRestart);

    d.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("start() called again from degraded does not stack a second pump interval", async () => {
    dispatcher.start();
    for (let i = 0; i < 3; i++) {
      bus.push(
        env({
          source: "idle_watcher",
          event_name: "idle.short",
          ts: NOW + i,
          dnd_override: false,
        }),
      );
      await vi.advanceTimersByTimeAsync(20);
      callDeferred[callDeferred.length - 1].resolve("network_drop");
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(dispatcher.state()).toBe("degraded");

    const timerCountBeforeRestart = vi.getTimerCount();
    dispatcher.start();
    expect(vi.getTimerCount()).toBe(timerCountBeforeRestart);

    dispatcher.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("dispatcher — posture", () => {
  async function pushPostureEvent(event_name: string, payload?: Record<string, unknown>) {
    bus.push(env({ event_name, hint_tier: 1, payload }));
    await vi.advanceTimersByTimeAsync(20);
  }

  it.each([
    [
      "user.window_sit_drop",
      { edge_local_ypx: 30, app: "Notes", window_title: "Meeting notes" },
      { state: "sitting", perched_on: { app: "Notes", window_title: "Meeting notes" } },
    ],
    ["user.window_sit_enter", undefined, { state: "sitting" }],
    [
      "user.peek_drop",
      { side: "left", target_local_xpx: 120, app: "Messages", window_title: "Alice" },
      { state: "peeking", perched_on: { app: "Messages", window_title: "Alice" } },
    ],
    ["user.drag_start", undefined, { state: "dragging" }],
  ] as const)("derives posture from %s", async (event_name, payload, expected) => {
    dispatcher.start();
    await pushPostureEvent(event_name, payload);
    expect(dispatcher.getPosture()).toEqual(expected);
  });

  it("replaces sitting posture with the next peeking posture", async () => {
    dispatcher.start();
    await pushPostureEvent("user.window_sit_drop", {
      edge_local_ypx: 30,
      app: "Notes",
      window_title: "Meeting notes",
    });
    expect(dispatcher.getPosture()).toEqual({
      state: "sitting",
      perched_on: { app: "Notes", window_title: "Meeting notes" },
    });

    await pushPostureEvent("user.peek_drop", {
      side: "left",
      target_local_xpx: 120,
      app: "Messages",
      window_title: "Alice",
    });
    expect(dispatcher.getPosture()).toEqual({
      state: "peeking",
      perched_on: { app: "Messages", window_title: "Alice" },
    });
  });

  it.each([
    [
      "user.window_sit_drop",
      { edge_local_ypx: 30, app: "Notes", window_title: null },
      { state: "sitting", perched_on: { app: "Notes" } },
    ],
    [
      "user.peek_drop",
      { side: "right", target_local_xpx: 120, app: null, window_title: "Alice" },
      { state: "peeking", perched_on: { window_title: "Alice" } },
    ],
  ] as const)("omits null identity fields from %s posture", async (event_name, payload, expected) => {
    dispatcher.start();
    await pushPostureEvent(event_name, payload);
    expect(dispatcher.getPosture()).toEqual(expected);
  });

  it.each([
    [
      "user.window_sit_drop",
      { edge_local_ypx: 30, app: null, window_title: null },
      { state: "sitting" },
    ],
    [
      "user.peek_drop",
      { side: "right", target_local_xpx: 120, app: null, window_title: null },
      { state: "peeking" },
    ],
  ] as const)("omits perched_on when %s has no identity", async (event_name, payload, expected) => {
    dispatcher.start();
    await pushPostureEvent(event_name, payload);
    expect(dispatcher.getPosture()).toEqual(expected);
  });

  it.each([
    [
      "user.window_sit_drop",
      { edge_local_ypx: 30, app: "Notes", window_title: "Meeting notes" },
      "user.window_sit_exit",
    ],
    [
      "user.peek_drop",
      { side: "left", target_local_xpx: 120, app: "Messages", window_title: "Alice" },
      "user.peek_exit",
    ],
    ["user.drag_start", undefined, "user.drag_end"],
  ] as const)("clears posture on %s", async (startEvent, payload, clearEvent) => {
    dispatcher.start();
    await pushPostureEvent(startEvent, payload);
    await pushPostureEvent(clearEvent);
    expect(dispatcher.getPosture()).toBeUndefined();
  });

  it("stamps body state with the wall clock of the posture change", async () => {
    dispatcher.start();
    const before = Date.now();
    await pushPostureEvent("user.window_sit_enter");
    const sitting = dispatcher.getBodyState()!;
    expect(sitting.posture).toEqual({ state: "sitting" });
    expect(sitting.since).toBeGreaterThanOrEqual(before);
    expect(sitting.since).toBeLessThanOrEqual(Date.now());

    await pushPostureEvent("user.drag_start");
    const dragging = dispatcher.getBodyState()!;
    expect(dragging.posture).toEqual({ state: "dragging" });
    expect(dragging.since).toBeGreaterThan(sitting.since);

    // elapsed time alone never moves the stamp
    vi.setSystemTime(Date.now() + 600_000);
    expect(dispatcher.getBodyState()?.since).toBe(dragging.since);
  });

  it("keeps the stamp when the held posture is re-affirmed", async () => {
    dispatcher.start();
    const perch = { edge_local_ypx: 30, app: "Notes", window_title: "Meeting notes" };
    await pushPostureEvent("user.window_sit_drop", perch);
    const first = dispatcher.getBodyState()!.since;

    await pushPostureEvent("user.window_sit_drop", perch);
    expect(dispatcher.getBodyState()?.since).toBe(first);

    // a different perch is a change
    await pushPostureEvent("user.window_sit_drop", { ...perch, window_title: "Grocery list" });
    expect(dispatcher.getBodyState()?.since).toBeGreaterThan(first);
  });

  it("leaves body state untouched on tier1 events that carry no posture", async () => {
    dispatcher.start();
    await pushPostureEvent("user.window_sit_enter");
    const sitting = dispatcher.getBodyState();

    await pushPostureEvent("user.tap_region", { region: "head" });
    await pushPostureEvent("idle.returned");
    expect(dispatcher.getBodyState()).toEqual(sitting);
  });

  it("reports no body state while the avatar stands free", async () => {
    dispatcher.start();
    expect(dispatcher.getBodyState()).toBeUndefined();
    await pushPostureEvent("user.drag_start");
    await pushPostureEvent("user.drag_end");
    expect(dispatcher.getBodyState()).toBeUndefined();
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
    expect(dispatcher.getPosture()).toBeUndefined();
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
    expect(dispatcher.getPosture()).toBeUndefined();
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
    await vi.advanceTimersByTimeAsync(TAP_CONFIG.touch_emotion_hold_ms);
    expect(easeEmotionToNeutral).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(TAP_CONFIG.touch_emotion_hold_ms * 2);
    expect(easeEmotionToNeutral).not.toHaveBeenCalled();
  });

  it("fires while a silent backend call is in flight (regression: isAudioOwed, not !isOver)", async () => {
    dispatcher.start();
    pushEmotionTap();
    await vi.advanceTimersByTimeAsync(20);
    // a second, silent backend call is admitted and never settles — the ledger is not over,
    // but nothing is owed, so the revert must still fire.
    bus.push(
      env({
        source: "idle_watcher",
        event_name: "idle.short",
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

  it("a superseded turn's late settle does not mark the superseding turn settled", async () => {
    dispatcher.start();
    bus.push(env({ ts: NOW }));
    await vi.advanceTimersByTimeAsync(20);
    const idA = turnLog.current()!.id;

    // a second user message supersedes A and immediately admits B.
    bus.push(env({ ts: NOW + 1 }));
    await vi.advanceTimersByTimeAsync(20);
    const idB = turnLog.current()!.id;
    expect(idB).not.toBe(idA);

    // A's aborted call resolves late — its own settle(idA) must not affect B.
    callDeferred[0].resolve("superseded_by_user");
    await vi.advanceTimersByTimeAsync(20);

    expect(turnLog.current()?.id).toBe(idB);
    expect(turnLog.isOver()).toBe(false);
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

  it("aborts the in-flight backend call when a new user.voice_segment_ready arrives", async () => {
    dispatcher.start();
    bus.push(env({ ts: NOW }));
    await vi.advanceTimersByTimeAsync(20);
    expect(callDeferred).toHaveLength(1);
    const first = callDeferred[0];
    expect(first.signal?.aborted).toBe(false);

    // voice turn arrives while first is in flight
    bus.push(
      env({
        event_name: "user.voice_segment_ready",
        ts: NOW + 1,
        payload: { text: "안녕" },
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(first.signal?.aborted).toBe(true);
  });

  it("drops queued tier2 events with superseded_by_user when a voice turn arrives", async () => {
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
    // now a voice turn supersedes
    bus.push(
      env({
        event_name: "user.voice_segment_ready",
        ts: NOW + 2,
        payload: { text: "안녕" },
      }),
    );
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
    setSpeaking(true);
    callDeferred[0].resolve("ok");
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

    setSpeaking(false);
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
    setSpeaking(true);

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

  it("defers a non-user turn that arrives via the fast path while speech is playing", async () => {
    dispatcher.start();
    setSpeaking(true);
    const queued = nonUser();
    bus.push(queued);
    await vi.advanceTimersByTimeAsync(20);

    expect(backendCaller.call as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(dispatcher.queue()).toContain(queued);
    expect(dispatcher.recentDrops(10).map((drop) => drop.event_name)).not.toContain(
      queued.event_name,
    );

    setSpeaking(false);
    await vi.advanceTimersByTimeAsync(20);

    expect(backendCaller.call as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    expect(dispatcher.inFlight()).not.toBeNull();
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
    setSpeaking(true);

    callDeferred[0].resolve("ok");
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
    callDeferred[0].resolve("ok");
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
    expect(DROP_SEVERITY.network_stall).toBe("warn");
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

  it("does NOT fire for a non-user-initiated trigger (idle.short), even on failure", async () => {
    const { d, sink } = makeDispatcherWithFailedTurnSink();
    d.start();
    bus.push(env({ event_name: "idle.short", dnd_override: undefined, source: "idle_watcher" }));
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
  /** Create dispatcher with real-config (§6 values) guardrails. */
  function makeGated(): { d: Dispatcher; g: Guardrails } {
    const g = createGuardrails(realGuardrailsConfig(), { now: () => Date.now() });
    const d = createDispatcher({
      bus,
      renderer: renderer as never,
      peekConfig: () => PEEK_CONFIG,
      tapConfig: () => TAP_CONFIG,
      backendCaller,
      guardrails: g,
      turnLog,
      logger,
    });
    return { d, g };
  }

  it("drops proactive.tap_bored during cooldown", async () => {
    const cfg = realGuardrailsConfig();
    cfg.rate_limit.tier2_max = 1000;
    cfg.debounce_ms.user_input_source = 0;
    const g = createGuardrails(cfg, { now: () => Date.now() });
    const d = createDispatcher({
      bus,
      renderer: renderer as never,
      peekConfig: () => PEEK_CONFIG,
      tapConfig: () => TAP_CONFIG,
      backendCaller,
      guardrails: g,
      turnLog,
      logger,
    });
    d.start();
    for (let i = 0; i < 21; i++) {
      g.evaluate(
        env({
          source: "user_input_source",
          event_name: "user.text_submitted",
          ts: NOW + i,
          dnd_override: false,
        }),
        2,
      );
    }
    expect(g.cooldownActive()).toBe(true);
    bus.push(
      env({
        source: "os_event_watcher",
        event_name: "proactive.tap_bored",
        hint_tier: 2,
        dnd_override: false,
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(backendCaller.call as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(d.recentDrops(10).some((dr) => dr.reason === "guardrail_drop")).toBe(true);
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
    callDeferred[0]?.resolve("ok");
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

  it("stop() with a call in flight leaves isPipelineBusy() false once the aborted call settles", async () => {
    dispatcher.start();
    bus.push(env());
    await vi.advanceTimersByTimeAsync(20);
    expect(dispatcher.isPipelineBusy()).toBe(true);

    dispatcher.stop();
    callDeferred[0].resolve("superseded_by_user");
    await vi.advanceTimersByTimeAsync(20);

    expect(dispatcher.isPipelineBusy()).toBe(false);
  });

  it("subscribeBusy fires true when a backend call starts, false when it completes", async () => {
    const seen: boolean[] = [];
    dispatcher.subscribeBusy((b) => seen.push(b));
    dispatcher.start();
    bus.push(env());
    await vi.advanceTimersByTimeAsync(20);
    expect(seen).toEqual([true]);
    callDeferred[0].resolve("ok");
    await vi.advanceTimersByTimeAsync(20);
    expect(seen).toEqual([true, false]);
  });

  it("subscribeBusy fires true for a non-user source as well — the edge is source-agnostic", async () => {
    const seen: boolean[] = [];
    dispatcher.subscribeBusy((b) => seen.push(b));
    dispatcher.start();
    bus.push(
      env({
        source: "idle_watcher",
        event_name: "idle.short",
        hint_tier: 2,
        dnd_override: false,
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(seen).toEqual([true]);
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
    callDeferred[0].resolve("ok");
    await vi.advanceTimersByTimeAsync(20);
    expect(seen).toEqual([]); // no false→...→true flicker on the boundary
    // second completes with nothing pending → now busy flips to false once.
    callDeferred[1].resolve("ok");
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
    callDeferred[0].resolve("ok");
    await vi.advanceTimersByTimeAsync(20);
    expect(seen).toEqual([true]);
  });
});

describe("dispatcher — isPipelineBusy/subscribePipelineBusy (busy = ledger not over)", () => {
  it("isPipelineBusy() is false at rest, true while a call is in flight", async () => {
    dispatcher.start();
    expect(dispatcher.isPipelineBusy()).toBe(false);
    bus.push(env());
    await vi.advanceTimersByTimeAsync(20);
    expect(dispatcher.isPipelineBusy()).toBe(true);
  });

  it("follows the ledger across the whole span: admitted, settled-but-owed, then idle", async () => {
    dispatcher.start();
    expect(dispatcher.isPipelineBusy()).toBe(false);

    bus.push(env());
    await vi.advanceTimersByTimeAsync(20);
    expect(dispatcher.isPipelineBusy()).toBe(true);

    setSpeaking(true);
    callDeferred[0].resolve("ok");
    await vi.advanceTimersByTimeAsync(20);
    expect(dispatcher.isPipelineBusy()).toBe(true);

    setSpeaking(false);
    await vi.advanceTimersByTimeAsync(20);
    expect(dispatcher.isPipelineBusy()).toBe(false);
  });

  it("subscribePipelineBusy fires true synchronously when the ledger admits the turn", async () => {
    const seen: boolean[] = [];
    dispatcher.subscribePipelineBusy((b) => seen.push(b));
    dispatcher.start();
    bus.push(env());
    await vi.advanceTimersByTimeAsync(20);
    expect(seen).toEqual([true]);
  });

  it("does not flip mid-drain: draining two events in one pump tick fires the edge only once", async () => {
    const seen: boolean[] = [];
    dispatcher.subscribePipelineBusy((b) => seen.push(b));
    dispatcher.start();
    // the second event is deferred behind the first (still pending) — no further ledger
    // mutation happens for it within this pump tick.
    bus.push(env({ ts: NOW }));
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
    expect(seen).toEqual([true]);
  });

  it("stays busy past inFlight completion while speaking; fires false only after speech ends", async () => {
    const seen: boolean[] = [];
    dispatcher.subscribePipelineBusy((b) => seen.push(b));
    dispatcher.start();
    bus.push(env());
    await vi.advanceTimersByTimeAsync(50);
    expect(seen).toEqual([true]);

    setSpeaking(true);
    callDeferred[0].resolve("ok");
    await vi.advanceTimersByTimeAsync(50);
    expect(dispatcher.isPipelineBusy()).toBe(true);
    expect(seen).toEqual([true]); // no false fired yet — still speaking

    setSpeaking(false);
    await vi.advanceTimersByTimeAsync(50);
    expect(seen).toEqual([true, false]);
  });

  it("draining a deferred item into a settled, silent turn's slot: busy stays true with no edge", async () => {
    const seen: boolean[] = [];
    dispatcher.subscribePipelineBusy((b) => seen.push(b));
    dispatcher.start();
    // both non-user, so neither pop triggers a supersede sweep — the second is genuinely deferred.
    bus.push(
      env({
        source: "idle_watcher",
        event_name: "idle.short",
        ts: NOW,
        hint_tier: 2,
        dnd_override: false,
      }),
    );
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
    expect(seen).toEqual([true]);

    // first call settles owing no audio, with the second item still pending — immediate drain.
    callDeferred[0]!.resolve("ok");
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
      peekConfig: () => PEEK_CONFIG,
      tapConfig: () => TAP_CONFIG,
      backendCaller,
      guardrails: g,
      turnLog,
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
      callDeferred[callDeferred.length - 1]?.resolve("ok");
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
    callDeferred[0].resolve("ok");
    await vi.advanceTimersByTimeAsync(20);

    const lines = turnLines();
    expect(lines).toHaveLength(1);
    const [, payload] = lines[0]!;
    expect(payload.id).toBe(1);
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

  it("two consecutive turns produce two turn lines with different ids", async () => {
    dispatcher.start();
    bus.push(env({ ts: NOW }));
    await vi.advanceTimersByTimeAsync(20);
    callDeferred[0].resolve("ok");
    await vi.advanceTimersByTimeAsync(20);

    bus.push(env({ ts: NOW + 1 }));
    await vi.advanceTimersByTimeAsync(20);
    callDeferred[1].resolve("ok");
    await vi.advanceTimersByTimeAsync(20);

    const lines = turnLines();
    expect(lines).toHaveLength(2);
    expect(lines[0]![1].id).toBe(1);
    expect(lines[1]![1].id).toBe(2);
  });

  it("a user turn superseding an in-flight turn: the superseded turn gets a turn line before the successor starts", async () => {
    dispatcher.start();
    bus.push(env({ ts: NOW }));
    await vi.advanceTimersByTimeAsync(20);
    const firstId = turnLog.current()!.id;
    expect(firstId).toBe(1);

    bus.push(env({ ts: NOW + 1 }));
    await vi.advanceTimersByTimeAsync(20);
    const secondId = turnLog.current()!.id;
    expect(secondId).toBe(2);

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
        source: "idle_watcher",
        event_name: "idle.short",
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
    bus.push(nonUserEnv({ event_name: "idle.long", ts: NOW + 1 }));
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
