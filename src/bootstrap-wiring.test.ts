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
      drain: () => [],
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
  showAndFocusFromSummon,
  wireBroker,
  wireDispatcherSources,
  wirePeekExitTriggers,
  wireSettingsReload,
  wireStopControl,
  wireVoiceInput,
} from "./bootstrap-wiring";
import { reloadFromStorage as reloadLocaleFromStorage } from "./ui/i18n";
import { createVoiceInputStatus } from "./ui/voice-input-status";

const noopLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

describe("wirePeekExitTriggers", () => {
  const setup = async () => {
    let focusHandler: ((event: { payload: boolean }) => void) | undefined;
    let trayHandler: (() => void) | undefined;
    let active = true;
    const exit = vi.fn(async () => {
      active = false;
    });
    const push = vi.fn();
    const dispose = await wirePeekExitTriggers({
      bus: { push } as never,
      peek: { active: () => active, exit },
      win: {
        onFocusChanged: vi.fn(async (handler) => {
          focusHandler = handler;
          return vi.fn();
        }),
        listen: vi.fn(async (_event, handler) => {
          trayHandler = handler;
          return vi.fn();
        }),
      },
    });
    return {
      exit,
      push,
      dispose,
      focus: (focused: boolean) => focusHandler?.({ payload: focused }),
      tray: () => trayHandler?.(),
      setActive: (next: boolean) => {
        active = next;
      },
    };
  };

  it("pushes exactly one peek exit on focus gain while active", async () => {
    const s = await setup();
    s.focus(true);
    s.focus(true);
    await Promise.resolve();
    expect(s.exit).toHaveBeenCalledTimes(1);
    expect(s.push).toHaveBeenCalledTimes(1);
    expect(s.push).toHaveBeenCalledWith(
      expect.objectContaining({ event_name: "user.peek_exit", hint_tier: 1 }),
    );
    s.dispose();
  });

  it("ignores focus loss and inactive focus gain", async () => {
    const s = await setup();
    s.focus(false);
    s.setActive(false);
    s.focus(true);
    await Promise.resolve();
    expect(s.exit).not.toHaveBeenCalled();
    expect(s.push).not.toHaveBeenCalled();
    s.dispose();
  });

  it("exits for either tray visibility toggle", async () => {
    const s = await setup();
    s.tray();
    await Promise.resolve();
    expect(s.exit).toHaveBeenCalledTimes(1);
    expect(s.push).toHaveBeenCalledTimes(1);
    s.dispose();
  });
});

describe("showAndFocusFromSummon", () => {
  it("awaits peek restoration before focusing and pushes the motion exit", async () => {
    const order: string[] = [];
    const push = vi.fn(() => order.push("push"));
    await showAndFocusFromSummon({
      bus: { push } as never,
      peek: {
        active: () => true,
        exit: vi.fn(async () => {
          order.push("exit-start");
          await Promise.resolve();
          order.push("exit-end");
        }),
      },
      win: {
        show: vi.fn(async () => {
          order.push("show");
        }),
        setFocus: vi.fn(async () => {
          order.push("focus");
        }),
      },
    });
    expect(order).toEqual(["show", "exit-start", "exit-end", "push", "focus"]);
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ event_name: "user.peek_exit" }));
  });
});

describe("wireDispatcherSources", () => {
  beforeEach(() => {
    for (const k of Object.keys(created)) delete created[k];
    started.length = 0;
  });

  it("creates and starts all four utterance sources", () => {
    const bus = {} as never;
    const pipelineBusy = { isBusy: () => false, subscribe: vi.fn(() => vi.fn()) };
    const result = wireDispatcherSources({
      bus,
      presenceSettings: { get: () => ({ present_max_idle_ms: 5000 }) },
      proactiveSettings: { get: () => ({ enabled: true, entries: [] }) },
      scheduleSettings: { get: () => ({ enabled: false, entries: [] }) },
      agentNotifySettings: { get: () => ({ enabled: true, port: 8770 }) },
      pipelineBusy,
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
    // pipelineBusy is forwarded to both agent + signals sources (not proactive/schedule).
    expect((created.agent as { isPipelineBusy: () => boolean }).isPipelineBusy).toBe(
      pipelineBusy.isBusy,
    );
    expect((created.signals as { subscribePipelineBusy: unknown }).subscribePipelineBusy).toBe(
      pipelineBusy.subscribe,
    );
    expect(result.signalsSource.drain()).toEqual([]);
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

describe("wireVoiceInput", () => {
  // Real voiceInputStatus store for fidelity; fake engine + settings so we can assert lifecycle calls.
  const makeSttVad = () => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    dispose: vi.fn(),
  });
  const makeSttSettings = (enabled: boolean) => ({
    get: () => ({ enabled }),
    setEnabled: vi.fn(),
  });
  // start() runs fire-and-forget out of the subscribe/setStt callbacks — drain a microtask to observe it.
  const flush = (): Promise<void> => Promise.resolve();

  it("auto-resumes on setStt when sttSettings.enabled is true", async () => {
    const voiceInputStatus = createVoiceInputStatus();
    const sttVad = makeSttVad();
    wireVoiceInput({ voiceInputStatus, sttSettings: makeSttSettings(true) }).setStt(
      sttVad as never,
    );
    await flush();
    expect(sttVad.start).toHaveBeenCalledTimes(1);
  });

  it("starts on listening and stops on idle after the engine is bound", async () => {
    const voiceInputStatus = createVoiceInputStatus();
    const sttVad = makeSttVad();
    wireVoiceInput({ voiceInputStatus, sttSettings: makeSttSettings(false) }).setStt(
      sttVad as never,
    );
    await flush();
    expect(sttVad.start).not.toHaveBeenCalled();
    voiceInputStatus.set("listening");
    await flush();
    expect(sttVad.start).toHaveBeenCalledTimes(1);
    voiceInputStatus.set("idle");
    expect(sttVad.stop).toHaveBeenCalledTimes(1);
  });

  it("defers a pre-bind listening request until setStt, then starts", async () => {
    const voiceInputStatus = createVoiceInputStatus();
    const sttVad = makeSttVad();
    const voiceInput = wireVoiceInput({
      voiceInputStatus,
      sttSettings: makeSttSettings(false),
    });
    voiceInputStatus.set("listening");
    await flush();
    // No engine yet → start not called.
    expect(sttVad.start).not.toHaveBeenCalled();
    voiceInput.setStt(sttVad as never);
    await flush();
    // startRequested path resumes once bound.
    expect(sttVad.start).toHaveBeenCalledTimes(1);
  });

  it("persists on/off intent to sttSettings", () => {
    const voiceInputStatus = createVoiceInputStatus();
    const sttSettings = makeSttSettings(false);
    wireVoiceInput({ voiceInputStatus, sttSettings });
    voiceInputStatus.set("listening");
    expect(sttSettings.setEnabled).toHaveBeenLastCalledWith(true);
    voiceInputStatus.set("idle");
    expect(sttSettings.setEnabled).toHaveBeenLastCalledWith(false);
  });

  it("dispose unsubscribes from the status store and disposes the engine", async () => {
    const voiceInputStatus = createVoiceInputStatus();
    const sttVad = makeSttVad();
    const voiceInput = wireVoiceInput({
      voiceInputStatus,
      sttSettings: makeSttSettings(false),
    });
    voiceInput.setStt(sttVad as never);
    await flush();
    voiceInput.dispose();
    expect(sttVad.dispose).toHaveBeenCalledTimes(1);
    sttVad.start.mockClear();
    voiceInputStatus.set("listening");
    await flush();
    expect(sttVad.start).not.toHaveBeenCalled();
  });
});

describe("wireStopControl", () => {
  it("stop click cancels the in-flight turn and aborts speech playback", () => {
    let stopCb: (() => void) | null = null;
    const cancel = vi.fn();
    const abortSpeech = vi.fn();
    wireStopControl({
      onStop: (cb) => {
        stopCb = cb;
      },
      cancel,
      abortSpeech,
    });

    expect(cancel).not.toHaveBeenCalled();
    stopCb!();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(abortSpeech).toHaveBeenCalledTimes(1);
  });
});
