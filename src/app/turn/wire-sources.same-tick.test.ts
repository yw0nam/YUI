/**
 * wire-sources.same-tick.test.ts — one idle tick due for both the idle check-in and the schedule greeting.
 *
 * Pins the full pipeline the way bootstrap composes it: the real proactive and schedule
 * sources over the shared `os_event` channel (proactive registered first), the real event
 * bus, dispatcher and proactive pacer. Faked: the Tauri channel, the clock (fake timers)
 * and the backend turn runner.
 *
 * The user-visible behaviour: when the dispatcher starts the check-in first, the greeting
 * held by the gap that turn anchors must still fire on a later tick inside its 120-minute
 * window — not be lost for the day.
 */

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createEventBus } from "../../dispatcher/core/event-bus";
import { createGuardrails } from "../../dispatcher/core/guardrails";
import { createProactivePacer } from "../../dispatcher/core/proactive-pacer";
import { createDispatcher } from "../../dispatcher/dispatcher";
import type { ScheduleSource } from "../../dispatcher/sources/idle-tick/schedule-source";
import {
  createDefaultAddressedChain,
  type DeferredCall,
  makeDeferredBackendCaller,
  makeLogger,
  permissiveGuardrailsConfig,
} from "../../dispatcher/test-helpers";
import { createTurnLog } from "../../dispatcher/turn/turn";
import type { OsEventListen, OsEventPayload } from "../../io/window/tauri-listen";
import type { ProactiveSettings } from "../../settings/cues/proactive-settings";
import type { ScheduleSettings } from "../../settings/cues/schedule-settings";
import { createFlagSettings } from "../../settings/persisted-store";
import { wireDispatcherSources } from "./wire-sources";

// The fake Tauri channel every real source subscribes to.
const channel = vi.hoisted(() => {
  const handlers = new Map<string, Set<(e: { payload: OsEventPayload }) => void>>();
  return {
    listen: (async (event: string, handler: (e: { payload: OsEventPayload }) => void) => {
      let set = handlers.get(event);
      if (!set) {
        set = new Set();
        handlers.set(event, set);
      }
      set.add(handler);
      return () => {
        set.delete(handler);
      };
    }) as OsEventListen,
    emit: (event: string, payload: unknown) => {
      for (const h of handlers.get(event) ?? []) h({ payload: payload as OsEventPayload });
    },
    reset: () => handlers.clear(),
  };
});

vi.mock("../../io/window/tauri-listen", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../io/window/tauri-listen")>();
  return {
    ...actual,
    resolveTauriListen: async () => channel.listen,
    // The real subscribeOsEvent closes over the real resolver, so inject the fake listen directly.
    subscribeOsEvent: (params: Parameters<typeof actual.subscribeOsEvent>[0]) =>
      actual.subscribeOsEvent({ ...params, listen: channel.listen }),
  };
});

// The milestone source would put a third candidate on this tick; this test is about the two cues.
vi.mock("../../dispatcher/sources/idle-tick/milestone-source", () => ({
  createMilestoneSource: vi.fn(() => ({ start: async () => {}, stop: () => {} })),
}));

const PRESENT_MAX = 10_000;
/** The proactive gap interval: a turn anchors the window for this long. */
const GAP_MS = 5 * 60_000;

const PROACTIVE_SETTINGS: ProactiveSettings = {
  enabled: true,
  entries: [{ id: "check_in", label: "Check-in", context: "ctx", enabled: true, idle_min: 30 }],
};
const SCHEDULE_SETTINGS: ScheduleSettings = {
  enabled: true,
  entries: [{ id: "morning", label: "Morning", context: "ctx", time: "09:00", enabled: true }],
};

const idleTick = (os_idle_ms: number): OsEventPayload => ({
  event_name: "os_idle_tick",
  ts: 0,
  data: { os_idle_ms },
});

/**
 * The pipeline the way bootstrap composes it: real bus, dispatcher, pacer, guardrails and
 * turn ledger; the proactive and schedule sources wired by wireDispatcherSources; only the
 * turn runner deferred (a backend call that never answers keeps the turn in flight, as in
 * production). Returns the measured turn-start order and drop log.
 */
function startPipeline(): {
  startOrder: string[];
  drops: Array<{ event_name: string; reason: string }>;
  completeTurn: () => void;
  stop: () => void;
} {
  const bus = createEventBus();
  const pacer = createProactivePacer({ getIntervalMs: () => GAP_MS });
  const callDeferred: DeferredCall[] = [];
  const startOrder: string[] = [];
  const drops: Array<{ event_name: string; reason: string }> = [];
  let schedule: Pick<ScheduleSource, "restore"> | null = null;
  const dispatcher = createDispatcher({
    bus,
    renderer: {
      applyDirective: vi.fn(),
      setPerchTarget: vi.fn(),
      setPeekTarget: vi.fn(),
      setMotionMirror: vi.fn(),
      easeEmotionToNeutral: vi.fn(),
      getCurrentMotion: vi.fn(() => null),
    } as never,
    backendCaller: makeDeferredBackendCaller(callDeferred),
    guardrails: createGuardrails(permissiveGuardrailsConfig(), { now: () => Date.now() }),
    turnLog: createTurnLog(),
    hasOutstandingSpeech: () => false,
    addressedChain: createDefaultAddressedChain(),
    peekConfig: () => ({
      side_out_frac: 0.28,
      side_in_frac: 0.23,
      inset_frac: 0.12,
      mirror_side: "right",
    }),
    tapConfig: () => ({
      spam_count: 4,
      spam_window_ms: 3_000,
      region_radius_frac: 0.18,
      region_motions: { head: "head_pat", chest: "embarrassed", hips: "embarrassed" },
      bored_cue: { label: "bored poking", context: "The user is poking repeatedly." },
      touch_cue_cooldown_ms: 60_000,
      touch_emotion_hold_ms: 4_000,
      pat_hold_ms: 300,
    }),
    pacer,
    logger: makeLogger(),
    onTurnAdmitted: (turn) => startOrder.push(turn.trigger.event_name),
    onTurnDropped: (env, reason) => {
      drops.push({ event_name: env.event_name, reason });
      schedule?.restore(env, reason);
    },
  });
  dispatcher.start();
  const sources = wireDispatcherSources({
    bus,
    presenceSettings: { get: () => ({ value: PRESENT_MAX }) },
    proactiveSettings: { get: () => PROACTIVE_SETTINGS },
    scheduleSettings: { get: () => SCHEDULE_SETTINGS },
    agentNotifySettings: { get: () => ({ enabled: false, port: 8770 }) },
    screenSettings: { get: () => ({ enabled: false }) },
    getScreenConfig: () => ({
      prev_dwell_ms: 600000,
      settle_ms: 90000,
      long_session_ms: 2700000,
      recent_cap: 5,
    }),
    pipelineBusy: { isBusy: () => false, subscribe: () => () => {} },
    pacer,
    dnd: createFlagSettings(false),
    paceFactor: () => 1,
    onCharacterAddressed: () => () => {},
    onUserTurnRouted: () => () => {},
    submitUser: vi.fn(),
    selfPresetId: "natsume",
    lastTogetherSettings: { get: () => ({ at: null }), record: () => {} },
  });
  schedule = sources.scheduleSource;
  /** Complete the in-flight backend call, freeing the dispatcher's single slot for the next fire. */
  const completeTurn = (): void => {
    callDeferred.shift()?.resolve("ok");
  };
  const stop = (): void => {
    dispatcher.stop();
    pacer.stop();
    for (const source of [
      sources.signalsSource,
      sources.proactiveSource,
      sources.scheduleSource,
      sources.milestoneSource,
      sources.screenSource,
      sources.addressedSource,
      sources.routedUserSource,
    ])
      source.stop();
  };
  return { startOrder, drops, completeTurn, stop };
}

beforeEach(() => {
  vi.useFakeTimers();
  channel.reset();
});
afterEach(() => {
  channel.reset();
  vi.useRealTimers();
});

it("a greeting due on the same tick as the idle check-in still fires once the gap opens", async () => {
  // 09:30 — bootstrap. The check-in cue's idle gap and the greeting's day anchor here.
  vi.setSystemTime(new Date(2026, 5, 15, 9, 30));
  const { startOrder, drops, completeTurn, stop } = startPipeline();
  // Let the fire-and-forget source starts subscribe to the fake channel.
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);

  // 10:05 — one tick finds both due: the check-in (30 idle minutes elapsed) and the
  // greeting (65 minutes after 09:00, inside the 120-minute window). User present, gap open.
  vi.setSystemTime(new Date(2026, 5, 15, 10, 5));
  channel.emit("os_event", idleTick(500));
  await vi.advanceTimersByTimeAsync(16);

  // Measured, not assumed: the dispatcher starts the check-in first; its turn anchors the
  // gap, and the greeting — already latched as fired for today at push time — is dropped
  // as global_gap.
  expect(startOrder).toEqual(["proactive.check_in"]);
  expect(drops).toContainEqual({ event_name: "schedule.morning", reason: "global_gap" });

  // The check-in ends; the drop cleared the greeting's mark for a later tick.
  completeTurn();
  await vi.advanceTimersByTimeAsync(0);

  // 10:11 — the gap opens inside the greeting's window; the next tick is the greeting's turn.
  await vi.advanceTimersByTimeAsync(6 * 60_000);
  channel.emit("os_event", idleTick(500));
  await vi.advanceTimersByTimeAsync(16);

  expect(startOrder).toEqual(["proactive.check_in", "schedule.morning"]);
  stop();
});
