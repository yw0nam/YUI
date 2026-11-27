/**
 * dispatcher.waiting.test.ts — self-started candidates that cannot speak now wait in the
 * waiting list, and go out together at the next free slot or ride the user's turn.
 */

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { PeekConfig, TapConfig } from "../config/validators/avatar/types";
import type { SignalGroup } from "../contract";
import type { BackendCaller } from "./backend/backend-caller";
import { type BusEnvelope, createEventBus, type EventBus } from "./core/event-bus";
import { createGuardrails, type GuardrailsConfig } from "./core/guardrails";
import { createDispatcher, type Dispatcher, type DispatcherDeps } from "./dispatcher";
import {
  createDefaultAddressedChain,
  type DeferredCall,
  makeDeferredBackendCaller,
  makeLogger,
  NOW,
  permissiveGuardrailsConfig,
  SIGNAL_ENVELOPE,
  userEnv,
} from "./test-helpers";
import { createTurnLog } from "./turn/turn";

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

const hhmm = (ts: number): string => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const scheduleCue = (): BusEnvelope => ({
  source: "timer_scheduler",
  event_name: "schedule.lunch",
  ts: NOW,
  payload: { cue_id: "lunch", label: "Lunch", time: hhmm(NOW) },
});
const firstMeeting = (): BusEnvelope => ({
  source: "os_event_watcher",
  event_name: "time_milestone.first_activity",
  ts: NOW + 1,
  payload: { name: "first_activity", local_time: hhmm(NOW), last_together: null },
});
const idleCue = (ts = NOW + 2): BusEnvelope => ({
  source: "timer_scheduler",
  event_name: "proactive.stretch",
  ts,
  payload: { cue_id: "stretch", label: "stretch" },
});
const gestureCue = (): BusEnvelope => ({
  source: "os_event_watcher",
  event_name: "proactive.touch_chest",
  ts: NOW,
  payload: { cue_id: "touch_chest", label: "chest poked" },
});
const group: SignalGroup = { envelope: SIGNAL_ENVELOPE, items: [{ text: "done" }] };

let bus: EventBus;
let callDeferred: DeferredCall[];
let backendCaller: BackendCaller;
let dispatcher: Dispatcher;
let dndOn: boolean;
let present: boolean;
let speaking: boolean;
let buffered: SignalGroup[];
let drainSignals: Mock<() => SignalGroup[]>;
let onTurnSpoken: Mock<(env: BusEnvelope) => void>;

function make(guardrails: GuardrailsConfig = permissiveGuardrailsConfig()): Dispatcher {
  dispatcher = createDispatcher({
    bus,
    renderer: {
      applyDirective: vi.fn(),
      setPerchTarget: vi.fn(),
      setPeekTarget: vi.fn(),
      setMotionMirror: vi.fn(),
      easeEmotionToNeutral: vi.fn(),
    } as never,
    backendCaller,
    guardrails: createGuardrails(guardrails, { now: () => Date.now() }),
    turnLog: createTurnLog(),
    hasOutstandingSpeech: () => speaking,
    addressedChain: createDefaultAddressedChain(),
    logger: makeLogger(),
    peekConfig: () => PEEK_CONFIG,
    tapConfig: () => TAP_CONFIG,
    isDndOn: () => dndOn,
    isPresent: () => present,
    drainSignals,
    // The buffer takes restored groups back.
    restoreSignals: (env) => buffered.push(...((env.payload?.signals as SignalGroup[]) ?? [])),
    onTurnSpoken,
  } as DispatcherDeps);
  dispatcher.start();
  return dispatcher;
}

const triggerOf = (call: number): BusEnvelope =>
  vi.mocked(backendCaller.call).mock.calls[call]![0].trigger;
const waitedOf = (trigger: BusEnvelope): string[] =>
  ((trigger.payload?.waited as BusEnvelope[] | undefined) ?? []).map((e) => e.event_name);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  bus = createEventBus();
  callDeferred = [];
  backendCaller = makeDeferredBackendCaller(callDeferred);
  dndOn = false;
  present = true;
  speaking = false;
  buffered = [];
  drainSignals = vi.fn(() => buffered.splice(0));
  onTurnSpoken = vi.fn();
});
afterEach(() => {
  dispatcher.stop();
  vi.useRealTimers();
});

describe("dispatcher — waiting list", () => {
  it("holds a schedule cue, the first meeting and an idle cue during DND, and sends them as one turn once DND ends and the user is present", async () => {
    dndOn = true;
    const d = make();
    for (const e of [scheduleCue(), firstMeeting(), idleCue()]) bus.push(e);
    await vi.advanceTimersByTimeAsync(20);
    expect(backendCaller.call).not.toHaveBeenCalled();

    dndOn = false;
    present = false;
    await vi.advanceTimersByTimeAsync(20);
    expect(backendCaller.call).not.toHaveBeenCalled();

    present = true;
    await vi.advanceTimersByTimeAsync(20);
    expect(backendCaller.call).toHaveBeenCalledOnce();
    const trigger = triggerOf(0);
    expect(trigger.event_name).toBe("time_milestone.first_activity");
    expect(waitedOf(trigger)).toEqual(["schedule.lunch", "proactive.stretch"]);
    expect(d.recentDrops()).toEqual([]);

    callDeferred[0]!.resolve("ok");
    await vi.advanceTimersByTimeAsync(20);
    expect(onTurnSpoken).toHaveBeenCalledWith(trigger);
  });

  it("lets a user turn during DND carry the schedule cue and the buffered signal groups, and drops the idle cue", async () => {
    dndOn = true;
    const d = make();
    buffered = [group];
    bus.push(scheduleCue());
    bus.push(idleCue());
    await vi.advanceTimersByTimeAsync(20);
    expect(drainSignals).not.toHaveBeenCalled();

    bus.push({ ...userEnv("hi"), ts: NOW + 3 });
    await vi.advanceTimersByTimeAsync(20);

    expect(backendCaller.call).toHaveBeenCalledOnce();
    const trigger = triggerOf(0);
    expect(trigger.event_name).toBe("user.text_submitted");
    expect(waitedOf(trigger)).toEqual(["schedule.lunch"]);
    expect(trigger.payload?.signals).toEqual([group]);
    expect(d.recentDrops()).toEqual([
      expect.objectContaining({ event_name: "proactive.stretch", reason: "waiting_expired" }),
    ]);
  });

  it("keeps a candidate the hourly cap refuses waiting, and sends it once a slot frees", async () => {
    const cfg = permissiveGuardrailsConfig();
    cfg.rate_limit = { ...cfg.rate_limit, tier2_max: 1, window_ms: 1_000 };
    const d = make(cfg);
    bus.push(idleCue(NOW));
    await vi.advanceTimersByTimeAsync(20);
    callDeferred[0]!.resolve("ok");
    bus.push({ ...idleCue(NOW + 30), event_name: "proactive.water", payload: { cue_id: "water" } });
    await vi.advanceTimersByTimeAsync(20);
    expect(backendCaller.call).toHaveBeenCalledOnce();
    expect(d.recentDrops()).toEqual([]);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(backendCaller.call).toHaveBeenCalledTimes(2);
    expect(triggerOf(1).event_name).toBe("proactive.water");
  });

  it("puts the members of a self-started turn the user cancels on the user's turn", async () => {
    const d = make();
    bus.push(scheduleCue());
    await vi.advanceTimersByTimeAsync(20);
    expect(triggerOf(0).event_name).toBe("schedule.lunch");

    bus.push({ ...userEnv("wait"), ts: NOW + 3 });
    await vi.advanceTimersByTimeAsync(20);

    expect(backendCaller.call).toHaveBeenCalledTimes(2);
    expect(triggerOf(1).event_name).toBe("user.text_submitted");
    expect(waitedOf(triggerOf(1))).toEqual(["schedule.lunch"]);
    expect((triggerOf(1).payload?.waited as BusEnvelope[])[0]!.ts).toBe(NOW);
    expect(d.recentDrops()).toEqual([]);
  });

  it("drops a failed bundle and does not send it again", async () => {
    dndOn = true;
    const d = make();
    bus.push(scheduleCue());
    bus.push(firstMeeting());
    await vi.advanceTimersByTimeAsync(20);
    dndOn = false;
    await vi.advanceTimersByTimeAsync(20);
    expect(backendCaller.call).toHaveBeenCalledOnce();
    expect(waitedOf(triggerOf(0))).toEqual(["schedule.lunch"]);

    callDeferred[0]!.resolve("network_drop");
    await vi.advanceTimersByTimeAsync(100);

    expect(backendCaller.call).toHaveBeenCalledOnce();
    expect(d.recentDrops()).toEqual([
      expect.objectContaining({
        event_name: "time_milestone.first_activity",
        reason: "network_drop",
      }),
    ]);
    expect(onTurnSpoken).not.toHaveBeenCalled();
  });

  it("returns the drained groups of a failed turn to the buffer", async () => {
    make();
    await vi.advanceTimersByTimeAsync(20);
    const second: SignalGroup = { envelope: { ...SIGNAL_ENVELOPE, event_id: "run-2" }, items: [] };
    buffered = [group, second];
    bus.push(scheduleCue());
    await vi.advanceTimersByTimeAsync(20);
    expect(triggerOf(0).payload?.signals).toEqual([group, second]);
    expect(buffered).toEqual([]);

    // Do-not-disturb keeps the restored groups from leaving again at once.
    dndOn = true;
    callDeferred[0]!.resolve("network_drop");
    await vi.advanceTimersByTimeAsync(20);
    expect(buffered).toEqual([group, second]);
  });

  it("returns the groups of a turn the stop button aborts to the buffer", async () => {
    const d = make();
    await vi.advanceTimersByTimeAsync(20);
    buffered = [group];
    bus.push(scheduleCue());
    await vi.advanceTimersByTimeAsync(20);
    expect(triggerOf(0).payload?.signals).toEqual([group]);

    d.cancel();
    expect(buffered).toEqual([group]);
    expect(d.queue()).toEqual([]);
  });

  it("starts the waiting bundle in the call's finally, so busy stays true across back-to-back turns", async () => {
    const d = make();
    bus.push(gestureCue());
    await vi.advanceTimersByTimeAsync(20);
    bus.push(scheduleCue());
    bus.push(idleCue());
    await vi.advanceTimersByTimeAsync(20);
    const busy = vi.fn();
    const pipelineBusy = vi.fn();
    d.subscribeBusy(busy);
    d.subscribePipelineBusy(pipelineBusy);

    callDeferred[0]!.resolve("ok");
    await vi.advanceTimersByTimeAsync(0);

    expect(backendCaller.call).toHaveBeenCalledTimes(2);
    expect(triggerOf(1).event_name).toBe("schedule.lunch");
    expect(waitedOf(triggerOf(1))).toEqual(["proactive.stretch"]);
    expect(busy).not.toHaveBeenCalledWith(false);
    expect(pipelineBusy).not.toHaveBeenCalledWith(false);
  });

  it("keeps a batched group that arrives while the slot is free buffered past the next tick", async () => {
    make();
    await vi.advanceTimersByTimeAsync(20);
    buffered = [group];
    await vi.advanceTimersByTimeAsync(100);

    expect(backendCaller.call).not.toHaveBeenCalled();
    expect(buffered).toEqual([group]);

    // The next edge into a free slot: a do-not-disturb hold ends.
    dndOn = true;
    await vi.advanceTimersByTimeAsync(20);
    dndOn = false;
    await vi.advanceTimersByTimeAsync(20);
    expect(backendCaller.call).toHaveBeenCalledOnce();
    expect(triggerOf(0)).toMatchObject({
      event_name: "signals.catchup",
      payload: { signals: [group] },
    });
  });

  it("sends the buffered batched groups only through the release at playback end", async () => {
    make();
    bus.push(userEnv("hi"));
    await vi.advanceTimersByTimeAsync(20);
    speaking = true;
    callDeferred[0]!.resolve("ok");
    buffered = [group];
    await vi.advanceTimersByTimeAsync(100);
    expect(buffered).toEqual([group]);
    expect(backendCaller.call).toHaveBeenCalledOnce();

    speaking = false;
    await vi.advanceTimersByTimeAsync(20);
    expect(backendCaller.call).toHaveBeenCalledTimes(2);
    expect(triggerOf(1)).toMatchObject({
      event_name: "signals.catchup",
      payload: { signals: [group] },
    });
  });
});
