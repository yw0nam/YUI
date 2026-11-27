/** The real sources wired the way bootstrap does: do-not-disturb and the proactive gap hold the signals inboxes, and the schedule pushes past both for the dispatcher to hold. */

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BusEnvelope } from "../../dispatcher/core/event-bus";
import type { OsEventListen, OsEventPayload } from "../../io/window/tauri-listen";
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

const PRESENT_MAX = 10_000;
const idleTick = (os_idle_ms: number): OsEventPayload => ({
  event_name: "os_idle_tick",
  ts: 0,
  data: { os_idle_ms },
});

beforeEach(() => {
  vi.useFakeTimers();
  channel.reset();
});
afterEach(() => {
  channel.reset();
  vi.useRealTimers();
});

function wireWithDnd(
  dnd: ReturnType<typeof createFlagSettings>,
  scheduleSettings: ScheduleSettings = { enabled: false, entries: [] },
  pacer: { isHolding: () => boolean; subscribe: () => () => void } = {
    isHolding: () => false,
    subscribe: () => () => {},
  },
) {
  const pushed: BusEnvelope[] = [];
  const sources = wireDispatcherSources({
    bus: {
      push: (env: BusEnvelope) => {
        pushed.push(env);
        return true;
      },
    } as never,
    presenceSettings: { get: () => ({ value: PRESENT_MAX }) },
    proactiveSettings: { get: () => ({ enabled: false, entries: [] }) },
    scheduleSettings: { get: () => scheduleSettings },
    agentNotifySettings: { get: () => ({ enabled: true, port: 8770 }) },
    screenSettings: { get: () => ({ enabled: false }) },
    getScreenConfig: () => ({
      prev_dwell_ms: 600000,
      settle_ms: 90000,
      long_session_ms: 2700000,
    }),
    pipelineBusy: { isBusy: () => false, subscribe: () => () => {} },
    pacer,
    dnd,
    paceFactor: () => 1,
    onCharacterAddressed: () => () => {},
    onUserTurnRouted: () => () => {},
    submitUser: vi.fn(),
    selfPresetId: "natsume",
    lastTogetherSettings: { get: () => ({ at: null }), record: () => {} },
  });
  const stop = (): void => {
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
  return { pushed, stop, sources };
}

it.each([
  ["do-not-disturb", true, false],
  ["the proactive gap", false, true],
])("pushes a due schedule cue once while %s holds, for the dispatcher to hold", async (_hold, dndOn, holding) => {
  vi.setSystemTime(new Date(2026, 5, 15, 9, 30));
  const schedule: ScheduleSettings = {
    enabled: true,
    entries: [{ id: "morning", label: "Morning", context: "ctx", time: "09:00", enabled: true }],
  };
  const { pushed, stop } = wireWithDnd(createFlagSettings(dndOn), schedule, {
    isHolding: () => holding,
    subscribe: () => () => {},
  });
  // Let the fire-and-forget source starts subscribe to the fake channel.
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
  const scheduled = () => pushed.filter((e) => e.event_name.startsWith("schedule."));

  channel.emit("os_event", idleTick(500));
  channel.emit("os_event", idleTick(500));
  expect(scheduled().map((e) => e.event_name)).toEqual(["schedule.morning"]);
  stop();
});

it("buffers an urgent and a batched group while DND is on; turning it off fires the urgent catch-up once and leaves the batched group to the drain", async () => {
  const dnd = createFlagSettings(true);
  const { pushed, stop, sources } = wireWithDnd(dnd);
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
  const envelope = (event_id: string, delivery: "batched" | "urgent") => ({
    source: "n8n",
    event_type: "workflow_done",
    delivery,
    event_id,
    occurred_at: 1_787_449_000_000,
  });

  channel.emit("os_event", idleTick(500));
  channel.emit("signals-inbox", {
    signals: [{ id: 1 }],
    ts: 1000,
    envelope: envelope("u1", "urgent"),
  });
  channel.emit("signals-inbox", {
    signals: [{ id: 2 }],
    ts: 2000,
    envelope: envelope("b2", "batched"),
  });
  expect(pushed).toEqual([]);

  expect(sources.drainSignals()).toEqual([]);

  dnd.setEnabled(false);
  expect(pushed.map((e) => [e.source, e.event_name])).toEqual([
    ["urgent_signal_source", "signals.urgent_catchup"],
  ]);
  expect(sources.drainSignals()).toEqual([
    { envelope: envelope("b2", "batched"), items: [{ id: 2 }] },
  ]);

  // A second DND cycle with an empty buffer fires nothing further.
  dnd.setEnabled(true);
  dnd.setEnabled(false);
  expect(pushed).toHaveLength(1);
  stop();
});
