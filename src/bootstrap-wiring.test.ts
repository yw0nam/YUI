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

// Broker fakes for wireBroker: a single captured client so tests can assert publish/start/dispose.
const { brokerClient, createBrokerClient, deriveBrokerPayload, createReconciler, selectFetch } =
  vi.hoisted(() => {
    const brokerClient = {
      publish: vi.fn().mockResolvedValue(undefined),
      start: vi.fn(),
      dispose: vi.fn(),
    };
    return {
      brokerClient,
      createBrokerClient: vi.fn(() => brokerClient),
      deriveBrokerPayload: vi.fn(() => ({ derived: true })),
      createReconciler: vi.fn(() => ({ onChange: vi.fn().mockResolvedValue(undefined) })),
      selectFetch: vi.fn().mockResolvedValue(undefined),
    };
  });
vi.mock("./io/broker-client", () => ({ createBrokerClient, deriveBrokerPayload }));
vi.mock("./io/broker-override-reconciler", () => ({
  createBrokerOverrideReconciler: createReconciler,
}));
vi.mock("./io/chat-client", () => ({ selectFetch }));
vi.mock("./config", () => ({ loadEmotionTextTable: vi.fn().mockResolvedValue(null) }));

import {
  createSettingsBroadcast,
  wireBroker,
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

describe("wireBroker", () => {
  beforeEach(() => {
    brokerClient.publish.mockClear();
    brokerClient.start.mockClear();
    brokerClient.dispose.mockClear();
    createBrokerClient.mockClear();
    deriveBrokerPayload.mockClear();
  });

  // wireBroker fires publish().then(start) fire-and-forget — drain the microtask queue to observe it.
  const flush = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
  };

  const makeDeps = (endpoints: Record<string, unknown>) => {
    const unsub = vi.fn();
    const endpointsSettings = { subscribe: vi.fn(() => unsub) };
    return {
      deps: {
        getConfig: () => ({ emotionRegistry: {}, motions: {}, endpoints: {} }) as never,
        getEndpoints: () => endpoints as never,
        endpointsSettings,
        log: noopLog,
      },
      unsub,
    };
  };

  it("publishes then starts when broker_base_url is present", async () => {
    const { deps } = makeDeps({ broker_base_url: "http://localhost:3201", tts_provider: "openai" });
    await wireBroker(deps);
    expect(createBrokerClient).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "http://localhost:3201" }),
    );
    expect(brokerClient.publish).toHaveBeenCalledTimes(1);
    await flush();
    expect(brokerClient.start).toHaveBeenCalledTimes(1);
  });

  it("does nothing when broker_base_url is empty", async () => {
    const { deps } = makeDeps({ broker_base_url: "" });
    await wireBroker(deps);
    expect(createBrokerClient).not.toHaveBeenCalled();
    expect(brokerClient.publish).not.toHaveBeenCalled();
  });

  it("re-publishes only on config sections that change renderable vocab", async () => {
    const { deps } = makeDeps({ broker_base_url: "http://localhost:3201", tts_provider: "openai" });
    const handle = await wireBroker(deps);
    await flush();
    brokerClient.publish.mockClear();
    const fakeCfg = { emotionRegistry: {}, motions: {}, endpoints: {} } as never;
    handle.onConfigChange(fakeCfg, new Set(["motions"]) as never);
    await flush();
    expect(brokerClient.publish).toHaveBeenCalledTimes(1);
    brokerClient.publish.mockClear();
    handle.onConfigChange(fakeCfg, new Set(["guardrails"]) as never);
    await flush();
    expect(brokerClient.publish).not.toHaveBeenCalled();
  });

  it("dispose unsubscribes the override listener and disposes the client", async () => {
    const { deps, unsub } = makeDeps({
      broker_base_url: "http://localhost:3201",
      tts_provider: "openai",
    });
    const handle = await wireBroker(deps);
    handle.dispose();
    expect(unsub).toHaveBeenCalledTimes(1);
    expect(brokerClient.dispose).toHaveBeenCalledTimes(1);
  });
});
