import { beforeEach, describe, expect, it, vi } from "vitest";

// Capture the deps each source factory is created with, and record start() calls.
// vi.hoisted so the shared state exists before the hoisted vi.mock factories run.
const { created, started, drainQueue, makeSource } = vi.hoisted(() => {
  const created: Record<string, unknown> = {};
  const started: string[] = [];
  // Groups a test posts to the signals source before a drain — emptied by drain(), as the real one does.
  const drainQueue: unknown[] = [];
  const makeSource = (name: string) => (deps: unknown) => {
    created[name] = deps;
    return {
      start: async () => {
        started.push(name);
      },
      stop: () => {},
      noteInteraction: () => {},
      drain: () => drainQueue.splice(0),
    };
  };
  return { created, started, drainQueue, makeSource };
});

vi.mock("../../dispatcher/sources/proactive-source", () => ({
  createProactiveSource: vi.fn(makeSource("proactive")),
}));

vi.mock("../../dispatcher/sources/schedule-source", () => ({
  createScheduleSource: vi.fn(makeSource("schedule")),
}));

vi.mock("../../dispatcher/sources/agent-source", () => ({
  createAgentSource: vi.fn(makeSource("agent")),
}));

vi.mock("../../dispatcher/sources/signals-source", () => ({
  createSignalsSource: vi.fn(makeSource("signals")),
}));

vi.mock("../../dispatcher/sources/screen-source", () => ({
  createScreenSource: vi.fn(makeSource("screen")),
}));

vi.mock("../../dispatcher/sources/milestone-source", () => ({
  createMilestoneSource: vi.fn(makeSource("milestone")),
}));

import { createScreenKnobSettings, mergeScreen } from "../../settings/capture/screen-settings";
import { wireSummonHotkey } from "../stage/wire-summon";
import { wireDispatcherSources, wireWindowSources } from "./wire-sources";

describe("configured platform wiring", () => {
  it("returns stable no-op handles outside Tauri", async () => {
    const windowSources = wireWindowSources({} as never);
    const summonHotkey = wireSummonHotkey({ accelerator: "CmdOrCtrl+Shift+Y" } as never);

    expect(() => {
      windowSources.noteUserDrag();
      windowSources.noteUserDragEnd();
      windowSources.dispose();
    }).not.toThrow();
    await expect(summonHotkey.apply("CmdOrCtrl+Shift+U")).resolves.toBeUndefined();
    await expect(summonHotkey.dispose()).resolves.toBeUndefined();
  });
});

describe("wireDispatcherSources", () => {
  beforeEach(() => {
    for (const k of Object.keys(created)) delete created[k];
    started.length = 0;
    drainQueue.length = 0;
  });

  const screenConfig = {
    prev_dwell_ms: 600000,
    settle_ms: 90000,
    long_session_ms: 2700000,
    min_gap_ms: 300000,
    quiet_after_turn_ms: 180000,
    recent_cap: 5,
  };

  /** Pacer stub whose hold state the test drives directly. */
  function fakePacer(holding = false) {
    let current = holding;
    const subscribers = new Set<(holding: boolean) => void>();
    return {
      isHolding: () => current,
      subscribe: (cb: (holding: boolean) => void) => {
        subscribers.add(cb);
        return () => {
          subscribers.delete(cb);
        };
      },
      setHolding(next: boolean): void {
        current = next;
        for (const cb of subscribers) cb(next);
      },
    };
  }

  it("creates and starts all six utterance sources", () => {
    const bus = {} as never;
    const pipelineBusy = { isBusy: () => false, subscribe: vi.fn(() => vi.fn()) };
    const subscribeBusy = vi.fn(() => vi.fn());
    const result = wireDispatcherSources({
      bus,
      presenceSettings: { get: () => ({ value: 5000 }) },
      proactiveSettings: { get: () => ({ enabled: true, entries: [] }) },
      scheduleSettings: { get: () => ({ enabled: false, entries: [] }) },
      agentNotifySettings: { get: () => ({ enabled: true, port: 8770 }) },
      screenSettings: { get: () => ({ enabled: false }) },
      getScreenConfig: () => screenConfig,
      subscribeBusy,
      pipelineBusy,
      pacer: fakePacer(),
    });

    expect(Object.keys(result).sort()).toEqual([
      "agentSource",
      "milestoneSource",
      "proactiveSource",
      "scheduleSource",
      "screenSource",
      "signalsSource",
    ]);
    // Each source is started (fire-and-forget) so candidate events flow once wired.
    expect(started.sort()).toEqual([
      "agent",
      "milestone",
      "proactive",
      "schedule",
      "screen",
      "signals",
    ]);
    // The dispatcher threshold is read from the presence store at creation time.
    expect((created.proactive as { present_max_idle_ms: number }).present_max_idle_ms).toBe(5000);
    // isEnabled reads live from the per-feature store.
    expect((created.schedule as { isEnabled: () => boolean }).isEnabled()).toBe(false);
    expect((created.signals as { isEnabled: () => boolean }).isEnabled()).toBe(true);
    // pipelineBusy reaches both agent + signals sources (not proactive/schedule).
    expect((created.agent as { isPipelineBusy: () => boolean }).isPipelineBusy()).toBe(false);
    const signalsDeps = created.signals as {
      subscribePipelineBusy: (cb: (busy: boolean) => void) => void;
    };
    signalsDeps.subscribePipelineBusy(vi.fn());
    expect(pipelineBusy.subscribe).toHaveBeenCalled();
    expect((created.proactive as { isPipelineBusy?: unknown }).isPipelineBusy).toBeUndefined();
    expect(result.signalsSource.drain()).toEqual([]);
  });

  it("gates the milestone source on the schedule setting, read live", () => {
    const schedule = { enabled: false, entries: [] };
    wireDispatcherSources({
      bus: {} as never,
      presenceSettings: { get: () => ({ value: 5000 }) },
      proactiveSettings: { get: () => ({ enabled: true, entries: [] }) },
      scheduleSettings: { get: () => schedule },
      agentNotifySettings: { get: () => ({ enabled: true, port: 8770 }) },
      screenSettings: { get: () => ({ enabled: false }) },
      getScreenConfig: () => screenConfig,
      subscribeBusy: vi.fn(() => vi.fn()),
      pipelineBusy: { isBusy: () => false, subscribe: vi.fn(() => vi.fn()) },
      pacer: fakePacer(),
    });

    const milestone = created.milestone as {
      present_max_idle_ms: number;
      isEnabled: () => boolean;
    };
    expect(milestone.present_max_idle_ms).toBe(5000);
    expect(milestone.isEnabled()).toBe(false);
    schedule.enabled = true;
    expect(milestone.isEnabled()).toBe(true);
  });

  it("hands the milestone source a drain that empties the signals buffers", () => {
    const result = wireDispatcherSources({
      bus: {} as never,
      presenceSettings: { get: () => ({ value: 5000 }) },
      proactiveSettings: { get: () => ({ enabled: true, entries: [] }) },
      scheduleSettings: { get: () => ({ enabled: true, entries: [] }) },
      agentNotifySettings: { get: () => ({ enabled: true, port: 8770 }) },
      screenSettings: { get: () => ({ enabled: false }) },
      getScreenConfig: () => screenConfig,
      subscribeBusy: vi.fn(() => vi.fn()),
      pipelineBusy: { isBusy: () => false, subscribe: vi.fn(() => vi.fn()) },
      pacer: fakePacer(),
    });

    const group = { items: [{ skill: "yui-daily-briefing" }] };
    drainQueue.push(group);
    const milestone = created.milestone as { drainSignals: () => unknown[] };

    expect(milestone.drainSignals()).toEqual([group]);
    // The groups rode the milestone turn, so the signals source has nothing left to deliver.
    expect(result.signalsSource.drain()).toEqual([]);
  });

  it("gates the screen source on its own flag and re-anchors idle cues on a fire", () => {
    const subscribeBusy = vi.fn(() => vi.fn());
    const result = wireDispatcherSources({
      bus: {} as never,
      presenceSettings: { get: () => ({ value: 5000 }) },
      proactiveSettings: { get: () => ({ enabled: true, entries: [] }) },
      scheduleSettings: { get: () => ({ enabled: false, entries: [] }) },
      agentNotifySettings: { get: () => ({ enabled: true, port: 8770 }) },
      screenSettings: { get: () => ({ enabled: true }) },
      getScreenConfig: () => screenConfig,
      subscribeBusy,
      pipelineBusy: { isBusy: () => false, subscribe: vi.fn(() => vi.fn()) },
      pacer: fakePacer(),
    });

    const screen = created.screen as {
      present_max_idle_ms: number;
      isEnabled: () => boolean;
      getConfig: () => typeof screenConfig;
      subscribeBusy: unknown;
      noteInteraction: () => void;
    };
    expect(screen.present_max_idle_ms).toBe(5000);
    expect(screen.isEnabled()).toBe(true);
    expect(screen.getConfig()).toEqual(screenConfig);
    // Turn edges come from the dispatcher's in-flight busy signal, not the pipeline-busy one.
    expect(screen.subscribeBusy).toBe(subscribeBusy);
    // A screen fire re-anchors the idle gap so proactive cues do not pile on.
    expect(screen.noteInteraction).toBe(result.proactiveSource.noteInteraction);
    expect(result.screenSource).toBeDefined();
  });

  it("hands the screen source knob overrides layered on the bundled thresholds, read live", () => {
    const knobs = createScreenKnobSettings();
    wireDispatcherSources({
      bus: {} as never,
      presenceSettings: { get: () => ({ value: 5000 }) },
      proactiveSettings: { get: () => ({ enabled: true, entries: [] }) },
      scheduleSettings: { get: () => ({ enabled: false, entries: [] }) },
      agentNotifySettings: { get: () => ({ enabled: true, port: 8770 }) },
      screenSettings: { get: () => ({ enabled: true }) },
      getScreenConfig: () => mergeScreen(screenConfig, knobs.get()),
      subscribeBusy: vi.fn(() => vi.fn()),
      pipelineBusy: { isBusy: () => false, subscribe: vi.fn(() => vi.fn()) },
      pacer: fakePacer(),
    });

    const screen = created.screen as { getConfig: () => typeof screenConfig };
    expect(screen.getConfig()).toEqual(screenConfig);

    knobs.set({ min_gap_ms: 60_000 });
    expect(screen.getConfig().min_gap_ms).toBe(60_000);
    expect(screen.getConfig().settle_ms).toBe(screenConfig.settle_ms);
  });

  function wireWithPacer(pacer: ReturnType<typeof fakePacer>) {
    return wireDispatcherSources({
      bus: {} as never,
      presenceSettings: { get: () => ({ value: 5000 }) },
      proactiveSettings: { get: () => ({ enabled: true, entries: [] }) },
      scheduleSettings: { get: () => ({ enabled: false, entries: [] }) },
      agentNotifySettings: { get: () => ({ enabled: true, port: 8770 }) },
      screenSettings: { get: () => ({ enabled: true }) },
      getScreenConfig: () => screenConfig,
      subscribeBusy: vi.fn(() => vi.fn()),
      pipelineBusy: { isBusy: () => false, subscribe: vi.fn(() => vi.fn()) },
      pacer,
    });
  }

  it("hands the screen source the pacer's hold predicate", () => {
    const pacer = fakePacer(true);
    wireWithPacer(pacer);

    const screen = created.screen as { isPacerHolding: () => boolean };
    expect(screen.isPacerHolding()).toBe(true);
    pacer.setHolding(false);
    expect(screen.isPacerHolding()).toBe(false);
  });

  // The two buffered-inbox sources hold their items instead of skipping them, so the pacer
  // reaches them as busy rather than as a gate of their own.
  const INBOX_SOURCES = ["agent", "signals"] as const;
  it.each(
    INBOX_SOURCES,
  )("composes the pacer into the busy predicate the %s source receives", (name) => {
    const pacer = fakePacer(false);
    wireWithPacer(pacer);

    const source = created[name] as {
      isPipelineBusy: () => boolean;
      subscribePipelineBusy: (cb: (busy: boolean) => void) => () => void;
    };
    const edges: boolean[] = [];
    const unsubscribe = source.subscribePipelineBusy((busy) => edges.push(busy));

    expect(source.isPipelineBusy()).toBe(false);
    pacer.setHolding(true);
    expect(source.isPipelineBusy()).toBe(true);
    expect(edges).toEqual([true]);

    pacer.setHolding(false);
    expect(source.isPipelineBusy()).toBe(false);
    expect(edges).toEqual([true, false]);

    unsubscribe();
    pacer.setHolding(true);
    expect(edges).toEqual([true, false]);
  });
});
