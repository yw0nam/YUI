/** The real proactive source wired the way bootstrap does: this pet window's pace factor scales the idle cues' idle_min. */

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BusEnvelope } from "../../dispatcher/core/event-bus";
import type { OsEventListen, OsEventPayload } from "../../io/window/tauri-listen";
import type { ProactiveCue } from "../../settings/cues/proactive-settings";
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

const cue: ProactiveCue = {
  id: "mid_check",
  label: "슬슬 체크",
  context: "ctx",
  idle_min: 10,
  enabled: true,
};

beforeEach(() => {
  vi.useFakeTimers();
  channel.reset();
});
afterEach(() => {
  channel.reset();
  vi.useRealTimers();
});

function wireWithPaceFactor(paceFactor: () => number) {
  const pushed: BusEnvelope[] = [];
  const sources = wireDispatcherSources({
    bus: {
      push: (env: BusEnvelope) => {
        pushed.push(env);
        return true;
      },
    } as never,
    presenceSettings: { get: () => ({ value: PRESENT_MAX }) },
    proactiveSettings: { get: () => ({ enabled: true, entries: [cue] }) },
    scheduleSettings: { get: () => ({ enabled: false, entries: [] }) },
    agentNotifySettings: { get: () => ({ enabled: false, port: 8770 }) },
    screenSettings: { get: () => ({ enabled: false }) },
    getScreenConfig: () => ({
      prev_dwell_ms: 600000,
      settle_ms: 90000,
      long_session_ms: 2700000,
      recent_cap: 5,
    }),
    pipelineBusy: { isBusy: () => false, subscribe: () => () => {} },
    pacer: { isHolding: () => false, subscribe: () => () => {} },
    dnd: { get: () => ({ enabled: false }), subscribe: () => () => {} },
    paceFactor,
    onCharacterAddressed: () => () => {},
    onUserTurnRouted: () => () => {},
    submitUser: vi.fn(),
    selfPresetId: "natsume",
    lastTogetherSettings: { get: () => ({ at: null }), record: () => {} },
  });
  const stop = (): void => {
    for (const source of [
      sources.proactiveSource,
      sources.scheduleSource,
      sources.signalsSource,
      sources.milestoneSource,
      sources.screenSource,
      sources.addressedSource,
      sources.routedUserSource,
    ])
      source.stop();
  };
  return { pushed, stop, proactiveSource: sources.proactiveSource };
}

it("a 10-minute idle cue fires after 5 present minutes when the pace factor is 0.5, and not at 4", async () => {
  vi.setSystemTime(new Date(2026, 5, 15, 9, 30));
  const { pushed, stop, proactiveSource } = wireWithPaceFactor(() => 0.5);
  // Let the fire-and-forget source starts subscribe to the fake channel.
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
  const proactive = () => pushed.filter((e) => e.event_name.startsWith("proactive."));

  // The interaction anchors the gap; the pace turns the cue's 10 minutes into 5.
  proactiveSource.noteInteraction();
  channel.emit("os_event", idleTick(500));
  expect(proactive()).toEqual([]);

  vi.advanceTimersByTime(4 * 60_000);
  channel.emit("os_event", idleTick(500));
  expect(proactive()).toEqual([]);

  vi.advanceTimersByTime(60_000);
  channel.emit("os_event", idleTick(500));
  expect(proactive().map((e) => e.event_name)).toEqual(["proactive.mid_check"]);
  stop();
});
