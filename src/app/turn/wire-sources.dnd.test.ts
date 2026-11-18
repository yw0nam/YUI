/** The real sources wired the way bootstrap does: do-not-disturb holds the schedule and the signals inboxes. */

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
      min_gap_ms: 300000,
      quiet_after_turn_ms: 180000,
      recent_cap: 5,
    }),
    subscribeBusy: () => () => {},
    pipelineBusy: { isBusy: () => false, subscribe: () => () => {} },
    pacer: { isHolding: () => false, subscribe: () => () => {} },
    dndSettings: dnd,
    onCharacterAddressed: () => () => {},
    onUserTurnRouted: () => () => {},
    submitUser: vi.fn(),
    selfPresetId: "natsume",
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
  return { pushed, stop };
}

it("pushes no due schedule cue while DND is on, and pushes it on the first tick after", async () => {
  vi.setSystemTime(new Date(2026, 5, 15, 9, 30));
  const dnd = createFlagSettings(true);
  const schedule: ScheduleSettings = {
    enabled: true,
    entries: [{ id: "morning", label: "Morning", context: "ctx", time: "09:00", enabled: true }],
  };
  const { pushed, stop } = wireWithDnd(dnd, schedule);
  // Let the fire-and-forget source starts subscribe to the fake channel.
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
  const scheduled = () => pushed.filter((e) => e.event_name.startsWith("schedule."));

  channel.emit("os_event", idleTick(500));
  expect(scheduled()).toEqual([]);

  dnd.setEnabled(false);
  channel.emit("os_event", idleTick(500));
  expect(scheduled().map((e) => e.event_name)).toEqual(["schedule.morning"]);
  stop();
});
