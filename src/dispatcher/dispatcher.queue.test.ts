/**
 * dispatcher.queue.test.ts — §5.2 conflict/supersede and the §337 playback-gated drain.
 *
 * Scope:
 *  - §5.2 conflict: user.text_submitted / user.voice_segment_ready arrival aborts an in-flight
 *    backend call (AbortController) and drops queued tier2/3 as superseded_by_user.
 *  - §337 playback-gated drain: a queued non-user turn holds behind speech still playing and
 *    drains once playback ends; a user turn still supersedes immediately.
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
    // queue a non-user tier2 behind it (won't run while in-flight)
    bus.push(
      env({
        source: "os_event_watcher",
        event_name: "proactive.tap_bored",
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
    // queue a non-user tier2 behind it (won't run while in-flight)
    bus.push(
      env({
        source: "os_event_watcher",
        event_name: "proactive.tap_bored",
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
      source: "os_event_watcher",
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
    // The backend started this speech on its own, so no turn on the ledger owns it.
    expect(turnLog.current()).toBeNull();
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
