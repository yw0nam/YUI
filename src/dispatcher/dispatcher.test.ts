/**
 * dispatcher.test.ts — state machine (§9), posture derivation, and the observable/busy dev APIs.
 *
 * Scope:
 *  - §9 state machine booting → running, restart guards from cooldown/degraded.
 *  - Posture derivation from tier1 body-state events (sit/peek/drag/walk/climb).
 *  - §11 observable dev APIs (queue / recent_drops / in_flight).
 *  - cancel() + subscribeBusy (chat stop button) and isPipelineBusy/subscribePipelineBusy.
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
  realGuardrailsConfig,
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
      hasOutstandingSpeech: () => speaking,
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
          source: "os_event_watcher",
          event_name: "proactive.tap_bored",
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
    ["avatar.walk_start", undefined, { state: "walking" }],
    ["avatar.climb_start", { direction: "up", app: "Notes" }, { state: "climbing" }],
    [
      "avatar.window_sit",
      { edge_local_ypx: 420, app: "Notes", window_title: "Meeting notes" },
      { state: "sitting", perched_on: { app: "Notes", window_title: "Meeting notes" } },
    ],
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
  ] as const)("returns to standing on %s", async (startEvent, payload, clearEvent) => {
    dispatcher.start();
    await pushPostureEvent(startEvent, payload);
    await pushPostureEvent(clearEvent);
    expect(dispatcher.getPosture()).toEqual({ state: "standing" });
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
    await pushPostureEvent("user.tap");
    expect(dispatcher.getBodyState()).toEqual(sitting);
  });

  it("returns to standing when the stroll ends", async () => {
    dispatcher.start();
    await pushPostureEvent("avatar.walk_start");
    expect(dispatcher.getPosture()).toEqual({ state: "walking" });
    await pushPostureEvent("avatar.walk_end");
    expect(dispatcher.getPosture()).toEqual({ state: "standing" });
  });

  it("leaves the posture standing and renders nothing when a fall lands", async () => {
    dispatcher.start();
    applyDirective.mockClear();
    const before = dispatcher.getBodyState();

    await pushPostureEvent("user.fall_land", { height_px: 640 });

    expect(dispatcher.getBodyState()).toEqual(before);
    expect(applyDirective).not.toHaveBeenCalled();
    expect(backendCaller.call).not.toHaveBeenCalled();
  });

  it("keeps the walking posture and renders nothing when she jumps", async () => {
    dispatcher.start();
    await pushPostureEvent("avatar.walk_start");
    applyDirective.mockClear();

    await pushPostureEvent("avatar.jump");

    expect(dispatcher.getPosture()).toEqual({ state: "walking" });
    expect(applyDirective).not.toHaveBeenCalled();
    expect(backendCaller.call).not.toHaveBeenCalled();
  });

  it("returns to standing when a climb down ends", async () => {
    dispatcher.start();
    await pushPostureEvent("avatar.climb_start", { direction: "down", app: "Notes" });
    expect(dispatcher.getPosture()).toEqual({ state: "climbing" });
    await pushPostureEvent("avatar.climb_end", { direction: "down", app: "Notes" });
    expect(dispatcher.getPosture()).toEqual({ state: "standing" });
  });

  it("renders nothing and fires no backend turn for a climb", async () => {
    dispatcher.start();
    applyDirective.mockClear();
    await pushPostureEvent("avatar.climb_start", { direction: "up", app: "Notes" });
    await pushPostureEvent("avatar.climb_end", { direction: "up", app: "Notes" });
    expect(applyDirective).not.toHaveBeenCalled();
    expect(backendCaller.call).not.toHaveBeenCalled();
  });

  it("sits the character on the ledge an ambient climb reached", async () => {
    dispatcher.start();
    applyDirective.mockClear();
    await pushPostureEvent("avatar.window_sit", {
      edge_local_ypx: 420,
      app: "Notes",
      window_title: "Meeting notes",
    });
    expect(applyDirective).toHaveBeenCalledTimes(1);
    expect(applyDirective.mock.calls[0][0].motion).toEqual({ id: "window_sit" });
    expect(setPerchTarget).toHaveBeenCalledWith({ edgeLocalYpx: 420 });
    expect(backendCaller.call).not.toHaveBeenCalled();
  });

  it("drops an ambient window sit that carries no edge", async () => {
    dispatcher.start();
    applyDirective.mockClear();
    await pushPostureEvent("avatar.window_sit", { app: "Notes" });
    expect(applyDirective).not.toHaveBeenCalled();
    expect(setPerchTarget).not.toHaveBeenCalled();
  });

  it("renders nothing and fires no backend turn for a stroll", async () => {
    dispatcher.start();
    applyDirective.mockClear();
    await pushPostureEvent("avatar.walk_start");
    await pushPostureEvent("avatar.walk_end");
    expect(applyDirective).not.toHaveBeenCalled();
    expect(backendCaller.call).not.toHaveBeenCalled();
  });

  it("reports standing before any posture event, and again once the avatar stands free", async () => {
    dispatcher.start();
    expect(dispatcher.getBodyState()?.posture).toEqual({ state: "standing" });
    await pushPostureEvent("user.drag_start");
    await pushPostureEvent("user.drag_end");
    expect(dispatcher.getBodyState()?.posture).toEqual({ state: "standing" });
  });

  it("a fresh dispatcher reports standing", () => {
    expect(dispatcher.getPosture()).toEqual({ state: "standing" });
    expect(dispatcher.getBodyState()?.posture).toEqual({ state: "standing" });
  });

  it("keeps the standing stamp when re-affirmed by a second exit event", async () => {
    dispatcher.start();
    const first = dispatcher.getBodyState()!.since;
    await pushPostureEvent("user.peek_exit");
    expect(dispatcher.getBodyState()?.since).toBe(first);
  });

  it("noteAvatarMoved() restamps standing and resets since", async () => {
    dispatcher.start();
    await pushPostureEvent("user.window_sit_drop", { edge_local_ypx: 30 });
    expect(dispatcher.getPosture()).toEqual({ state: "sitting" });

    vi.setSystemTime(NOW + 60_000);
    dispatcher.noteAvatarMoved();
    expect(dispatcher.getPosture()).toEqual({ state: "standing" });
    expect(dispatcher.getBodyState()?.since).toBe(NOW + 60_000);
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
        source: "os_event_watcher",
        event_name: "proactive.tap_bored",
        ts: NOW + 1,
        hint_tier: 2,
        dnd_override: false,
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(dispatcher.queue().length).toBeGreaterThan(0);
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
        source: "os_event_watcher",
        event_name: "proactive.tap_bored",
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
        source: "os_event_watcher",
        event_name: "proactive.tap_bored",
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
        source: "os_event_watcher",
        event_name: "proactive.tap_bored",
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
        source: "os_event_watcher",
        event_name: "proactive.tap_bored",
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
        source: "os_event_watcher",
        event_name: "proactive.tap_bored",
        ts: NOW,
        hint_tier: 2,
        dnd_override: false,
      }),
    );
    bus.push(
      env({
        source: "os_event_watcher",
        event_name: "proactive.drag_held",
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
