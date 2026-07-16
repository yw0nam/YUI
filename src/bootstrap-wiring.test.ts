import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Capture the deps each source factory is created with, and record start() calls.
// vi.hoisted so the shared state exists before the hoisted vi.mock factories run.
const { created, started, makeSource } = vi.hoisted(() => {
  const created: Record<string, unknown> = {};
  const started: string[] = [];
  const makeSource = (name: string) => (deps: unknown) => {
    created[name] = deps;
    return {
      start: async () => {
        started.push(name);
      },
      stop: () => {},
      noteInteraction: () => {},
    };
  };
  return { created, started, makeSource };
});

vi.mock("./dispatcher/proactive-source", () => ({
  createProactiveSource: vi.fn(makeSource("proactive")),
}));
vi.mock("./dispatcher/schedule-source", () => ({
  createScheduleSource: vi.fn(makeSource("schedule")),
}));
vi.mock("./dispatcher/agent-source", () => ({
  createAgentSource: vi.fn(makeSource("agent")),
}));
vi.mock("./dispatcher/signals-source", () => ({
  createSignalsSource: vi.fn(makeSource("signals")),
}));
// i18n is a side-effecting singleton; stub it so the settings-sync tests stay isolated.
vi.mock("./ui/i18n", () => ({
  subscribe: () => () => {},
  reloadFromStorage: vi.fn(),
}));

import {
  createSettingsBroadcast,
  wireDispatcherSources,
  wireSettingsReload,
} from "./bootstrap-wiring";
import { reloadFromStorage as reloadLocaleFromStorage } from "./ui/i18n";

const noopLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

describe("wireDispatcherSources", () => {
  beforeEach(() => {
    for (const k of Object.keys(created)) delete created[k];
    started.length = 0;
  });

  it("creates and starts all four utterance sources", () => {
    const bus = {} as never;
    const result = wireDispatcherSources({
      bus,
      presenceSettings: { get: () => ({ present_max_idle_ms: 5000 }) },
      proactiveSettings: { get: () => ({ enabled: true, entries: [] }) },
      scheduleSettings: { get: () => ({ enabled: false, entries: [] }) },
      agentNotifySettings: { get: () => ({ enabled: true, port: 8770 }) },
    });

    expect(Object.keys(result).sort()).toEqual([
      "agentSource",
      "proactiveSource",
      "scheduleSource",
      "signalsSource",
    ]);
    // Each source is started (fire-and-forget) so candidate events flow once wired.
    expect(started.sort()).toEqual(["agent", "proactive", "schedule", "signals"]);
    // present_max_idle_ms is read from the presence store at creation time.
    expect((created.proactive as { present_max_idle_ms: number }).present_max_idle_ms).toBe(5000);
    // isEnabled reads live from the per-feature store.
    expect((created.schedule as { isEnabled: () => boolean }).isEnabled()).toBe(false);
    expect((created.signals as { isEnabled: () => boolean }).isEnabled()).toBe(true);
  });
});

describe("createSettingsBroadcast", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces bursts into a single cross-window emit", () => {
    const emitSettingsChanged = vi.fn();
    const { broadcastSettings } = createSettingsBroadcast({
      bridge: { emitSettingsChanged },
      syncedStores: [],
      cameraSettings: { subscribe: () => () => {} },
    });
    broadcastSettings();
    broadcastSettings();
    broadcastSettings();
    expect(emitSettingsChanged).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(emitSettingsChanged).toHaveBeenCalledTimes(1);
  });

  it("loop-guards: broadcasts fired during a remote apply are suppressed", () => {
    const emitSettingsChanged = vi.fn();
    const { broadcastSettings, runApplyingRemote } = createSettingsBroadcast({
      bridge: { emitSettingsChanged },
      syncedStores: [],
      cameraSettings: { subscribe: () => () => {} },
    });
    runApplyingRemote(() => broadcastSettings());
    vi.advanceTimersByTime(200);
    expect(emitSettingsChanged).not.toHaveBeenCalled();
  });

  it("subscribes every synced store plus camera to the broadcast", () => {
    const store = { subscribe: vi.fn(), reloadFromStorage: vi.fn() };
    const cameraSettings = { subscribe: vi.fn() };
    createSettingsBroadcast({
      bridge: { emitSettingsChanged: vi.fn() },
      syncedStores: [store],
      cameraSettings,
    });
    expect(store.subscribe).toHaveBeenCalledTimes(1);
    expect(cameraSettings.subscribe).toHaveBeenCalledTimes(1);
  });
});

describe("wireSettingsReload", () => {
  beforeEach(() => vi.clearAllMocks());

  const setup = (vrmUrls: { before: string; after: string }) => {
    let handler = (): void => {};
    const store = { subscribe: vi.fn(), reloadFromStorage: vi.fn() };
    const cameraSettings = { reloadFromStorage: vi.fn() };
    const speakerSelection = { reloadFromStorage: vi.fn() };
    const loadVrmSerialized = vi.fn(() => Promise.resolve({} as never));
    let url = vrmUrls.before;
    const vrmSelection = {
      getActive: () => ({ url }) as never,
      reloadFromStorage: vi.fn(() => {
        url = vrmUrls.after;
      }),
    };
    const runApplyingRemote = vi.fn((apply: () => void) => apply());
    wireSettingsReload({
      bridge: { onSettingsChanged: (h) => (handler = h) },
      syncedStores: [store],
      cameraSettings,
      runApplyingRemote,
      vrmSelection,
      loadVrmSerialized,
      speakerSelection,
      log: noopLog,
    });
    return {
      fire: () => handler(),
      store,
      cameraSettings,
      speakerSelection,
      loadVrmSerialized,
      runApplyingRemote,
    };
  };

  it("reloads every store under the loop guard on a remote change", () => {
    const s = setup({ before: "a.vrm", after: "a.vrm" });
    s.fire();
    expect(s.runApplyingRemote).toHaveBeenCalledTimes(1);
    expect(s.store.reloadFromStorage).toHaveBeenCalledTimes(1);
    expect(s.cameraSettings.reloadFromStorage).toHaveBeenCalledTimes(1);
    expect(s.speakerSelection.reloadFromStorage).toHaveBeenCalledTimes(1);
    expect(reloadLocaleFromStorage).toHaveBeenCalledTimes(1);
  });

  it("hot-swaps the VRM only when its url actually changed", () => {
    const unchanged = setup({ before: "a.vrm", after: "a.vrm" });
    unchanged.fire();
    expect(unchanged.loadVrmSerialized).not.toHaveBeenCalled();

    const changed = setup({ before: "a.vrm", after: "b.vrm" });
    changed.fire();
    expect(changed.loadVrmSerialized).toHaveBeenCalledWith("b.vrm");
  });
});
