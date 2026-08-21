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
vi.mock("./dispatcher/screen-source", () => ({
  createScreenSource: vi.fn(makeSource("screen")),
}));
// i18n is a side-effecting singleton; stub it so the settings-sync tests stay isolated.
const { unsubscribeLocale } = vi.hoisted(() => ({ unsubscribeLocale: vi.fn() }));
vi.mock("./ui/i18n", () => ({
  subscribe: () => unsubscribeLocale,
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

// Voices-API fakes — wireSpeakerSelection's refreshVoiceList exercises listVoices;
// commitVoiceImport and refreshSpeaker (tests below) exercise upsertVoice directly.
const { deleteVoice, listVoices, upsertVoice } = vi.hoisted(() => ({
  deleteVoice: vi.fn().mockResolvedValue(undefined),
  listVoices: vi.fn().mockResolvedValue([]),
  upsertVoice: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./io/tts-voices", () => ({ deleteVoice, listVoices, upsertVoice }));

// voice-import fakes — wireSpeakerSelection's pickVoiceImport/commitVoiceImport exercise these
// directly; keeps the suite off the real dialog plugin / Tauri invoke.
const { pickVoiceFile, copyVoiceFile, removeOrphanVoice, removeUserVoiceMock } = vi.hoisted(() => ({
  pickVoiceFile: vi.fn(),
  copyVoiceFile: vi.fn(),
  removeOrphanVoice: vi.fn(async (id: string, remove: (id: string) => Promise<void>) => {
    await remove(id);
  }),
  removeUserVoiceMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./io/voice-import", () => ({
  pickVoiceFile,
  copyVoiceFile,
  fileStemFromPath: (path: string) => {
    const base = path.split(/[\\/]/).pop() ?? path;
    const dot = base.lastIndexOf(".");
    return dot > 0 ? base.slice(0, dot) : base;
  },
  removeOrphanVoice,
  removeUserVoice: removeUserVoiceMock,
}));

// Fake bridge for wireCrossWindowSync: captures the onMouthPreview/onVoiceSet callbacks so
// tests can invoke them directly (a real bridge instance never delivers its own emits to itself).
const { fakeBridge, createSettingsBridge } = vi.hoisted(() => {
  const fakeBridge = {
    emitSettingsChanged: vi.fn(),
    onSettingsChanged: vi.fn(() => vi.fn()),
    emitMouthPreview: vi.fn(),
    onMouthPreview: vi.fn(),
    emitVoiceSet: vi.fn(),
    onVoiceSet: vi.fn(),
    emitVoiceState: vi.fn(),
    onVoiceState: vi.fn(),
    dispose: vi.fn(),
  };
  return { fakeBridge, createSettingsBridge: vi.fn(() => fakeBridge) };
});
vi.mock("./io/settings-bridge", () => ({ createSettingsBridge }));
const { wireStorageSyncDispose, wireStorageSync } = vi.hoisted(() => {
  const wireStorageSyncDispose = vi.fn();
  // Typed so `.mock.calls[0][0]` is the ReadonlyArray<{ reloadFromStorage() }> wireWindowSync
  // hands it, not an untyped `[]` — an untyped vi.fn() infers a zero-arity call signature.
  const wireStorageSync = vi.fn(
    (_stores: ReadonlyArray<{ reloadFromStorage(): void }>) => wireStorageSyncDispose,
  );
  return { wireStorageSyncDispose, wireStorageSync };
});
vi.mock("./io/settings-window", () => ({ wireStorageSync }));
const { mockDriver, createMockDriver } = vi.hoisted(() => {
  const mockDriver = { reply: vi.fn(), proactive: vi.fn(), speak: vi.fn() };
  return { mockDriver, createMockDriver: vi.fn(() => mockDriver) };
});
vi.mock("./ui/mock", () => ({ createMockDriver }));

import {
  createEffectiveEndpoints,
  createSettingsBroadcast,
  showAndFocusFromSummon,
  wireBroker,
  wireCrossWindowSync,
  wireDevGlobals,
  wireDevtoolsSync,
  wireDispatcherSources,
  wireGuardrailsOverrides,
  wirePeekExitTriggers,
  wireSettingsReload,
  wireSettingsWindowSync,
  wireSpeakerSelection,
  wireStopControl,
  wireSummonHotkey,
  wireVoiceInput,
  wireWindowSources,
  wireWindowSync,
} from "./bootstrap-wiring";
import { loadEmotionTextTable } from "./config";
import type { GuardrailsConfig } from "./config/load";
import type { EndpointsConfig } from "./contract";
import { createGuardrails } from "./dispatcher/guardrails";
import type { EndpointOverrides } from "./io/endpoints-settings";
import { createGuardrailsSettings, mergeGuardrails } from "./io/guardrails-settings";
import { createScreenKnobSettings, mergeScreen } from "./io/screen-settings";
import type { BridgeTransport } from "./io/settings-bridge";
import {
  broadcastSyncStores,
  createSettingsStores,
  reloadSyncStores,
  type SyncedStore,
} from "./io/settings-stores";
import { createVoiceListRefresh } from "./io/voice-list-refresh";
import { reloadFromStorage as reloadLocaleFromStorage } from "./ui/i18n";
import { createVoiceInputStatus } from "./ui/voice-input-status";

const noopLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

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

  it("removes the focus listener when tray listener setup fails", async () => {
    const unlistenFocus = vi.fn();
    const failure = new Error("tray listen failed");

    await expect(
      wirePeekExitTriggers({
        bus: { push: vi.fn() } as never,
        peek: { active: () => false, exit: vi.fn() },
        win: {
          onFocusChanged: vi.fn(async () => unlistenFocus),
          listen: vi.fn(async () => {
            throw failure;
          }),
        },
      }),
    ).rejects.toThrow(failure);
    expect(unlistenFocus).toHaveBeenCalledOnce();
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

  it("creates and starts all five utterance sources", () => {
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
      "proactiveSource",
      "scheduleSource",
      "screenSource",
      "signalsSource",
    ]);
    // Each source is started (fire-and-forget) so candidate events flow once wired.
    expect(started.sort()).toEqual(["agent", "proactive", "schedule", "screen", "signals"]);
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

describe("createSettingsBroadcast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    unsubscribeLocale.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it("debounces bursts into a single cross-window emit", () => {
    const emitSettingsChanged = vi.fn();
    const { broadcastSettings } = createSettingsBroadcast({
      bridge: { emitSettingsChanged },
      syncedStores: [],
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
    });
    runApplyingRemote(() => broadcastSettings());
    vi.advanceTimersByTime(200);
    expect(emitSettingsChanged).not.toHaveBeenCalled();
  });

  it("subscribes every synced store to the broadcast", () => {
    const store = { subscribe: vi.fn(() => vi.fn()), reloadFromStorage: vi.fn() };
    createSettingsBroadcast({
      bridge: { emitSettingsChanged: vi.fn() },
      syncedStores: [store],
    });
    expect(store.subscribe).toHaveBeenCalledTimes(1);
  });

  it("dispose unsubscribes every store and locale subscription", () => {
    const subscribers = new Set<() => void>();
    const unsubscribeStore = vi.fn();
    const store = {
      subscribe: vi.fn((cb: () => void) => {
        subscribers.add(cb);
        return () => {
          subscribers.delete(cb);
          unsubscribeStore();
        };
      }),
      reloadFromStorage: vi.fn(),
    };
    const emitSettingsChanged = vi.fn();
    const { dispose } = createSettingsBroadcast({
      bridge: { emitSettingsChanged },
      syncedStores: [store],
    });

    dispose();
    for (const subscriber of subscribers) subscriber();
    vi.advanceTimersByTime(200);

    expect(unsubscribeStore).toHaveBeenCalledTimes(1);
    expect(unsubscribeLocale).toHaveBeenCalledTimes(1);
    expect(emitSettingsChanged).not.toHaveBeenCalled();
  });

  // Teardown commits (dirty endpoint/key fields) land inside the debounce window.
  it("dispose flushes a pending broadcast instead of dropping it", () => {
    const emitSettingsChanged = vi.fn();
    const { broadcastSettings, dispose } = createSettingsBroadcast({
      bridge: { emitSettingsChanged },
      syncedStores: [],
    });

    broadcastSettings();
    dispose();

    expect(emitSettingsChanged).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(200);
    expect(emitSettingsChanged).toHaveBeenCalledTimes(1);
  });

  // Callers hold broadcastSettings past dispose (VRM/speaker selections), so a late notify
  // must not re-arm a timer that emits on an already-disposed bridge.
  it("ignores a broadcast requested after dispose", () => {
    const emitSettingsChanged = vi.fn();
    const { broadcastSettings, dispose } = createSettingsBroadcast({
      bridge: { emitSettingsChanged },
      syncedStores: [],
    });

    dispose();
    broadcastSettings();
    vi.advanceTimersByTime(200);

    expect(emitSettingsChanged).not.toHaveBeenCalled();
  });
});

describe("wireSettingsReload", () => {
  beforeEach(() => vi.clearAllMocks());

  const setup = (vrmUrls: { before: string; after: string }) => {
    let hook = (): void => {};
    const speakerSelection = { reloadFromStorage: vi.fn() };
    const loadVrmSerialized = vi.fn(() => Promise.resolve({} as never));
    let url = vrmUrls.before;
    const vrmSelection = {
      getActive: () => ({ url }) as never,
      reloadFromStorage: vi.fn(() => {
        url = vrmUrls.after;
      }),
    };
    wireSettingsReload({
      onRemoteChange: (cb) => (hook = cb),
      vrmSelection,
      loadVrmSerialized,
      speakerSelection,
      log: noopLog,
    });
    return { fire: () => hook(), speakerSelection, loadVrmSerialized };
  };

  it("reloads the speaker selection on a remote change", () => {
    const s = setup({ before: "a.vrm", after: "a.vrm" });
    s.fire();
    expect(s.speakerSelection.reloadFromStorage).toHaveBeenCalledTimes(1);
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

describe("wireSpeakerSelection — refreshVoiceList", () => {
  beforeEach(() => {
    listVoices.mockReset().mockResolvedValue([]);
    selectFetch.mockClear();
  });

  it("does not call listVoices when tts_base_url is unset", async () => {
    const { refreshVoiceList, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({}),
      log: noopLog,
      broadcastSettings: () => {},
    });

    await refreshVoiceList();

    expect(listVoices).not.toHaveBeenCalled();
    speakerSelection.dispose();
  });

  it("feeds the server voice list into the manifest, mapped to id/label/empty ref_url", async () => {
    listVoices.mockResolvedValue(["ナツメ", "あやせ"]);
    const { refreshVoiceList, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({
        tts_base_url: "http://localhost:8091",
        tts_speaker: "ナツメ",
      }),
      log: noopLog,
      broadcastSettings: () => {},
    });

    await refreshVoiceList();

    expect(listVoices).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "http://localhost:8091" }),
    );
    expect(speakerSelection.list()).toEqual([
      { id: "ナツメ", label: "ナツメ", ref_url: "" },
      { id: "あやせ", label: "あやせ", ref_url: "" },
    ]);
    expect(speakerSelection.getActiveId()).toBe("ナツメ");
    speakerSelection.dispose();
  });

  it("a user-imported voice registered under its own id on the server keeps its label and asset:// ref_url", async () => {
    const { refreshVoiceList, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({
        tts_base_url: "http://localhost:8091",
        tts_speaker: "ナツメ",
      }),
      log: noopLog,
      broadcastSettings: () => {},
    });
    speakerSelection.addUserOption({
      id: "myvoice",
      label: "My Voice",
      ref_url: "asset://localhost/app-data/references/myvoice/clip.mp3",
    });

    // The server now also lists "myvoice" — it was registered at import time.
    listVoices.mockResolvedValue(["ナツメ", "myvoice"]);
    await refreshVoiceList();

    const rows = speakerSelection.list().filter((o) => o.id === "myvoice");
    expect(rows).toHaveLength(1); // not duplicated — one row, not two
    expect(rows[0]).toEqual({
      id: "myvoice",
      label: "My Voice",
      ref_url: "asset://localhost/app-data/references/myvoice/clip.mp3",
      source: "user",
    });
    // Untouched server-only id still lands as a normal server entry.
    expect(speakerSelection.list().find((o) => o.id === "ナツメ")).toEqual({
      id: "ナツメ",
      label: "ナツメ",
      ref_url: "",
    });
    speakerSelection.dispose();
  });

  it("an empty server voice list yields a genuinely empty list — no phantom configured-default entry", async () => {
    listVoices.mockResolvedValue([]);
    const { refreshVoiceList, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({
        tts_base_url: "http://localhost:8091",
        tts_speaker: "ナツメ",
      }),
      log: noopLog,
      broadcastSettings: () => {},
    });

    await refreshVoiceList();

    expect(speakerSelection.list()).toEqual([]);
    expect(speakerSelection.getActiveId()).toBe("");
    speakerSelection.dispose();
  });

  it("does not select a configured tts_speaker absent from a non-empty server list", async () => {
    listVoices.mockResolvedValue(["あやせ", "レナ"]);
    const { refreshVoiceList, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({
        tts_base_url: "http://localhost:8091",
        tts_speaker: "ナツメ", // configured, but the server doesn't have it
      }),
      log: noopLog,
      broadcastSettings: () => {},
    });

    await refreshVoiceList();

    expect(speakerSelection.list().map((o) => o.id)).toEqual(["あやせ", "レナ"]);
    // Falls back to the first real (non-phantom) entry — never the unregistered configured id.
    expect(speakerSelection.getActiveId()).toBe("あやせ");
    speakerSelection.dispose();
  });

  it("selects the configured tts_speaker when the server list contains it (unchanged from before)", async () => {
    listVoices.mockResolvedValue(["あやせ", "ナツメ"]);
    const { refreshVoiceList, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({
        tts_base_url: "http://localhost:8091",
        tts_speaker: "ナツメ",
      }),
      log: noopLog,
      broadcastSettings: () => {},
    });

    await refreshVoiceList();

    expect(speakerSelection.getActiveId()).toBe("ナツメ");
    speakerSelection.dispose();
  });

  it("does not let a slow earlier refresh clobber a newer manifest (out-of-order resolution)", async () => {
    // First call is slow and would resolve to a stale, single-voice manifest.
    let resolveSlow: (ids: string[]) => void = () => {};
    const slow = new Promise<string[]>((res) => {
      resolveSlow = res;
    });
    listVoices.mockReturnValueOnce(slow);
    const { refreshVoiceList, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({
        tts_base_url: "http://localhost:8091",
        tts_speaker: "ナツメ",
      }),
      log: noopLog,
      broadcastSettings: () => {},
    });

    const first = refreshVoiceList(); // in flight, slow

    // Second call is fast and resolves first with the actually-current manifest.
    listVoices.mockResolvedValueOnce(["ナツメ", "あやせ"]);
    await refreshVoiceList();
    expect(speakerSelection.list().map((o) => o.id)).toEqual(["ナツメ", "あやせ"]);

    // The slow first call now resolves — it must be discarded, not overwrite the newer manifest.
    resolveSlow(["stale-only-voice"]);
    await first;
    expect(speakerSelection.list().map((o) => o.id)).toEqual(["ナツメ", "あやせ"]);

    speakerSelection.dispose();
  });
});

describe("wireSpeakerSelection — pickVoiceImport / commitVoiceImport", () => {
  beforeEach(() => {
    listVoices.mockReset().mockResolvedValue([]);
    upsertVoice.mockReset().mockResolvedValue(undefined);
    pickVoiceFile.mockReset();
    copyVoiceFile.mockReset();
    removeOrphanVoice.mockClear();
    removeUserVoiceMock.mockReset().mockResolvedValue(undefined);
    selectFetch.mockClear();
  });

  it("pickVoiceImport returns null (cancel) without touching copyVoiceFile", async () => {
    pickVoiceFile.mockResolvedValue(null);
    const { pickVoiceImport, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({ tts_base_url: "http://localhost:8091" }),
      log: noopLog,
      broadcastSettings: () => {},
    });

    const out = await pickVoiceImport();

    expect(out).toBeNull();
    expect(copyVoiceFile).not.toHaveBeenCalled();
    speakerSelection.dispose();
  });

  it("pickVoiceImport returns the srcPath + a seed name derived from the file stem", async () => {
    pickVoiceFile.mockResolvedValue("/Users/me/Downloads/ナツメ.wav");
    const { pickVoiceImport, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({ tts_base_url: "http://localhost:8091" }),
      log: noopLog,
      broadcastSettings: () => {},
    });

    const out = await pickVoiceImport();

    expect(out).toEqual({ srcPath: "/Users/me/Downloads/ナツメ.wav", seedName: "ナツメ" });
    speakerSelection.dispose();
  });

  it("commitVoiceImport uploads via upsertVoice and commits the option to the store", async () => {
    copyVoiceFile.mockResolvedValue({
      id: "myvoice",
      label: "myvoice",
      ref_url: "asset://localhost/app-data/references/myvoice/clip.wav",
      source: "user",
    });
    const { commitVoiceImport, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({ tts_base_url: "http://localhost:8091" }),
      log: noopLog,
      broadcastSettings: () => {},
    });

    await commitVoiceImport("/tmp/MyVoice.wav", "myvoice");

    expect(copyVoiceFile).toHaveBeenCalledWith("/tmp/MyVoice.wav", "myvoice");
    expect(upsertVoice).toHaveBeenCalledOnce();
    expect(speakerSelection.list().map((o) => o.id)).toContain("myvoice");
    expect(speakerSelection.getActiveId()).toBe("myvoice");
    speakerSelection.dispose();
  });

  it("commitVoiceImport overwrites via upsertVoice when the server already lists the id (duplicate name)", async () => {
    copyVoiceFile.mockResolvedValue({
      id: "natsume",
      label: "natsume",
      ref_url: "asset://localhost/app-data/references/natsume/clip.wav",
      source: "user",
    });
    listVoices.mockResolvedValue(["natsume"]); // server already has this id — explicit overwrite
    const { commitVoiceImport, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({ tts_base_url: "http://localhost:8091" }),
      log: noopLog,
      broadcastSettings: () => {},
    });

    await commitVoiceImport("/tmp/New.wav", "natsume");

    expect(upsertVoice).toHaveBeenCalledOnce();
    expect(upsertVoice.mock.calls[0][0]).toMatchObject({ id: "natsume" });
    expect(speakerSelection.getActiveId()).toBe("natsume");
    speakerSelection.dispose();
  });

  it("on registration failure, cleans up the orphan copy and still throws (option never added)", async () => {
    copyVoiceFile.mockResolvedValue({
      id: "myvoice",
      label: "myvoice",
      ref_url: "asset://localhost/app-data/references/myvoice/clip.wav",
      source: "user",
    });
    upsertVoice.mockRejectedValue(new Error("server down"));
    const { commitVoiceImport, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({ tts_base_url: "http://localhost:8091" }),
      log: noopLog,
      broadcastSettings: () => {},
    });

    await expect(commitVoiceImport("/tmp/MyVoice.wav", "myvoice")).rejects.toThrow("server down");

    expect(removeOrphanVoice).toHaveBeenCalledWith(
      "myvoice",
      expect.any(Function),
      expect.any(Function),
    );
    expect(removeUserVoiceMock).toHaveBeenCalledWith("myvoice");
    expect(speakerSelection.list().map((o) => o.id)).not.toContain("myvoice");
    speakerSelection.dispose();
  });

  it("throws without copying when tts_base_url is unset (guard before any upload)", async () => {
    copyVoiceFile.mockResolvedValue({
      id: "myvoice",
      label: "myvoice",
      ref_url: "asset://localhost/app-data/references/myvoice/clip.wav",
      source: "user",
    });
    const { commitVoiceImport, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({}),
      log: noopLog,
      broadcastSettings: () => {},
    });

    await expect(commitVoiceImport("/tmp/MyVoice.wav", "myvoice")).rejects.toThrow("tts_base_url");
    expect(removeOrphanVoice).toHaveBeenCalledWith(
      "myvoice",
      expect.any(Function),
      expect.any(Function),
    );
    speakerSelection.dispose();
  });

  // Pins the refreshVoiceList regression fix (excludes source:"user" ids from the server-derived
  // manifest) specifically for the new pick/commit flow: a voice just imported via commitVoiceImport
  // must not get clobbered by a refreshVoiceList triggered right after (e.g. the next panel open).
  it("a voice imported via commitVoiceImport survives a refreshVoiceList right after (next panel open)", async () => {
    copyVoiceFile.mockResolvedValue({
      id: "myvoice",
      label: "My Voice",
      ref_url: "asset://localhost/app-data/references/myvoice/clip.wav",
      source: "user",
    });
    listVoices.mockResolvedValue([]); // not registered yet at commit time
    const { commitVoiceImport, refreshVoiceList, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({ tts_base_url: "http://localhost:8091" }),
      log: noopLog,
      broadcastSettings: () => {},
    });

    await commitVoiceImport("/tmp/MyVoice.wav", "My Voice");
    expect(speakerSelection.list().map((o) => o.id)).toContain("myvoice");

    // The server now also lists it (registered at import time) — simulate the next panel open.
    listVoices.mockResolvedValue(["myvoice"]);
    await refreshVoiceList();

    const rows = speakerSelection.list().filter((o) => o.id === "myvoice");
    expect(rows).toHaveLength(1); // not duplicated
    expect(rows[0]).toEqual({
      id: "myvoice",
      label: "My Voice",
      ref_url: "asset://localhost/app-data/references/myvoice/clip.wav",
      source: "user",
      revision: 1,
    });
    speakerSelection.dispose();
  });
});

describe("createEffectiveEndpoints", () => {
  const overrides = (patch: Partial<EndpointOverrides> = {}): EndpointOverrides => ({
    chat_base_url: "",
    stt_base_url: "",
    tts_base_url: "",
    broker_base_url: "",
    chat_model: "",
    chat_model_context_window: "",
    chat_api: "",
    ...patch,
  });
  const bundled = (patch: Partial<EndpointsConfig> = {}): EndpointsConfig => ({
    chat_base_url: "",
    chat_endpoint: "",
    stt_base_url: "",
    tts_base_url: "",
    ...patch,
  });

  // The bug this pins: the settings window read the bundled config directly, so a TTS server set
  // only as a user override left it issuing no requests at all.
  it("layers a user override onto a bundled config that has no URL of its own", () => {
    const getEndpoints = createEffectiveEndpoints({
      getBundled: () => bundled(),
      getOverrides: () => overrides({ tts_base_url: "http://override.test" }),
    });

    expect(getEndpoints()?.tts_base_url).toBe("http://override.test");
  });

  it("keeps the bundled value when no override is set", () => {
    const getEndpoints = createEffectiveEndpoints({
      getBundled: () => bundled({ tts_base_url: "http://bundled.test" }),
      getOverrides: () => overrides(),
    });

    expect(getEndpoints()?.tts_base_url).toBe("http://bundled.test");
  });

  it("resolves null while the config has not loaded", () => {
    const getEndpoints = createEffectiveEndpoints({
      getBundled: () => null,
      getOverrides: () => overrides({ tts_base_url: "http://override.test" }),
    });

    expect(getEndpoints()).toBeNull();
  });

  it("re-reads both sides per call, so a later override edit takes effect", () => {
    let ov = overrides();
    const getEndpoints = createEffectiveEndpoints({
      getBundled: () => bundled(),
      getOverrides: () => ov,
    });

    expect(getEndpoints()?.tts_base_url).toBe("");
    ov = overrides({ tts_base_url: "http://override.test" });
    expect(getEndpoints()?.tts_base_url).toBe("http://override.test");
  });

  // Every network consumer of the settings window reaches the server through wireSpeakerSelection,
  // so the override has to survive that composition — not merely the merge in isolation.
  describe("composed into wireSpeakerSelection", () => {
    const overrideOnly = () =>
      createEffectiveEndpoints({
        getBundled: () => bundled(),
        getOverrides: () => overrides({ tts_base_url: "http://override.test" }),
      });

    beforeEach(() => {
      listVoices.mockReset().mockResolvedValue(["ナツメ"]);
      upsertVoice.mockReset().mockResolvedValue(undefined);
      copyVoiceFile.mockReset();
      pickVoiceFile.mockReset();
    });

    it("refreshVoiceList reaches the override URL", async () => {
      const { refreshVoiceList, speakerSelection } = wireSpeakerSelection({
        getEndpoints: overrideOnly(),
        log: noopLog,
        broadcastSettings: () => {},
      });

      await refreshVoiceList();

      expect(listVoices).toHaveBeenCalledWith(
        expect.objectContaining({ baseUrl: "http://override.test" }),
      );
      speakerSelection.dispose();
    });

    it("refreshSpeaker uploads to the override URL", async () => {
      const { refreshSpeaker, speakerSelection } = wireSpeakerSelection({
        getEndpoints: overrideOnly(),
        log: noopLog,
        broadcastSettings: () => {},
      });
      const option = { id: "myvoice", ref_url: "asset://x/clip.wav", source: "user" as const };
      speakerSelection.addUserOption(option);

      await refreshSpeaker(option);

      expect(upsertVoice).toHaveBeenCalledWith(
        expect.objectContaining({ baseUrl: "http://override.test" }),
      );
      speakerSelection.dispose();
    });

    it("commitVoiceImport uploads to the override URL", async () => {
      copyVoiceFile.mockResolvedValue({
        id: "myvoice",
        label: "My Voice",
        ref_url: "asset://x/clip.wav",
        source: "user",
      });
      const { commitVoiceImport, speakerSelection } = wireSpeakerSelection({
        getEndpoints: overrideOnly(),
        log: noopLog,
        broadcastSettings: () => {},
      });

      await commitVoiceImport("/tmp/MyVoice.wav", "My Voice");

      expect(upsertVoice).toHaveBeenCalledWith(
        expect.objectContaining({ baseUrl: "http://override.test" }),
      );
      speakerSelection.dispose();
    });

    // The settings window loads its config best-effort, so every consumer has to survive the
    // not-yet-loaded window with its own error rather than dereferencing null.
    it("reports a missing server cleanly while the config has not loaded", async () => {
      const notLoaded = createEffectiveEndpoints({
        getBundled: () => null,
        getOverrides: () => overrides(),
      });
      copyVoiceFile.mockResolvedValue({
        id: "myvoice",
        label: "My Voice",
        ref_url: "asset://x/clip.wav",
        source: "user",
      });
      const { refreshVoiceList, refreshSpeaker, commitVoiceImport, speakerSelection } =
        wireSpeakerSelection({
          getEndpoints: notLoaded,
          log: noopLog,
          broadcastSettings: () => {},
        });

      await expect(refreshVoiceList()).resolves.toBeUndefined();
      expect(listVoices).not.toHaveBeenCalled();

      await expect(
        refreshSpeaker({ id: "myvoice", ref_url: "asset://x/clip.wav" }),
      ).rejects.toThrow("voice refresh requires tts_base_url");

      await expect(commitVoiceImport("/tmp/MyVoice.wav", "My Voice")).rejects.toThrow(
        "voice import requires tts_base_url",
      );
      expect(upsertVoice).not.toHaveBeenCalled();

      speakerSelection.dispose();
    });
  });

  // The settings window's voice list is the only place a speaker can be picked, so an
  // override-only TTS server has to reach listVoices for the picker to populate at all.
  it("carries the override all the way into the voice-list request", async () => {
    const getEndpoints = createEffectiveEndpoints({
      getBundled: () => bundled(),
      getOverrides: () => overrides({ tts_base_url: "http://override.test" }),
    });
    const refreshVoiceList = createVoiceListRefresh({
      getEndpoints,
      speakerSelection: { list: () => [], setManifest: () => {} },
      log: noopLog,
    });

    await refreshVoiceList();

    expect(listVoices).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "http://override.test" }),
    );
  });
});

describe("wireSpeakerSelection — swapSpeaker / refreshSpeaker", () => {
  const USER_VOICE = {
    id: "myvoice",
    label: "My Voice",
    ref_url: "asset://localhost/app-data/references/myvoice/clip.wav",
    source: "user" as const,
  };

  beforeEach(() => {
    deleteVoice.mockReset().mockResolvedValue(undefined);
    listVoices.mockReset().mockResolvedValue([]);
    upsertVoice.mockReset().mockResolvedValue(undefined);
    removeUserVoiceMock.mockReset().mockResolvedValue(undefined);
    selectFetch.mockClear();
  });

  // Voices live on the server across restarts, so selecting one is a store commit and nothing else.
  it("swapSpeaker commits the selection without any upload", async () => {
    const { swapSpeaker, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({ tts_base_url: "http://localhost:8091" }),
      log: noopLog,
      broadcastSettings: () => {},
    });
    speakerSelection.addUserOption(USER_VOICE);

    await swapSpeaker(USER_VOICE);

    expect(upsertVoice).not.toHaveBeenCalled();
    expect(speakerSelection.getActiveId()).toBe("myvoice");
    speakerSelection.dispose();
  });

  it("refreshSpeaker re-uploads the clip and bumps the persisted revision", async () => {
    const { refreshSpeaker, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({ tts_base_url: "http://localhost:8091" }),
      log: noopLog,
      broadcastSettings: () => {},
    });
    speakerSelection.addUserOption({ ...USER_VOICE, revision: 2 });

    await refreshSpeaker({ ...USER_VOICE, revision: 2 });

    expect(upsertVoice).toHaveBeenCalledOnce();
    expect(upsertVoice.mock.calls[0][0]).toMatchObject({
      baseUrl: "http://localhost:8091",
      id: "myvoice",
      refUrl: USER_VOICE.ref_url,
    });
    expect(speakerSelection.list().find((o) => o.id === "myvoice")?.revision).toBe(3);
    speakerSelection.dispose();
  });

  it("refreshSpeaker starts the revision at 1 for a never-refreshed voice", async () => {
    const { refreshSpeaker, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({ tts_base_url: "http://localhost:8091" }),
      log: noopLog,
      broadcastSettings: () => {},
    });
    speakerSelection.addUserOption(USER_VOICE);

    await refreshSpeaker(USER_VOICE);

    expect(speakerSelection.list().find((o) => o.id === "myvoice")?.revision).toBe(1);
    speakerSelection.dispose();
  });

  it("refreshSpeaker leaves the revision alone when the upload fails", async () => {
    upsertVoice.mockRejectedValue(new Error("server down"));
    const { refreshSpeaker, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({ tts_base_url: "http://localhost:8091" }),
      log: noopLog,
      broadcastSettings: () => {},
    });
    speakerSelection.addUserOption({ ...USER_VOICE, revision: 2 });

    await expect(refreshSpeaker({ ...USER_VOICE, revision: 2 })).rejects.toThrow("server down");

    expect(speakerSelection.list().find((o) => o.id === "myvoice")?.revision).toBe(2);
    speakerSelection.dispose();
  });

  it("refreshSpeaker throws when tts_base_url is unset", async () => {
    const { refreshSpeaker, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({}),
      log: noopLog,
      broadcastSettings: () => {},
    });

    await expect(refreshSpeaker(USER_VOICE)).rejects.toThrow("tts_base_url");
    expect(upsertVoice).not.toHaveBeenCalled();
    speakerSelection.dispose();
  });

  it("removes the server voice before deleting the local reference clip", async () => {
    const { removeVoice, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({ tts_base_url: "http://localhost:8091" }),
      getApiKey: async () => "sk-tts",
      log: noopLog,
      broadcastSettings: () => {},
    });
    speakerSelection.addUserOption(USER_VOICE);

    await removeVoice("myvoice");

    expect(deleteVoice).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "http://localhost:8091",
        id: "myvoice",
        getApiKey: expect.any(Function),
      }),
    );
    expect(deleteVoice.mock.invocationCallOrder[0]).toBeLessThan(
      removeUserVoiceMock.mock.invocationCallOrder[0],
    );
    speakerSelection.dispose();
  });

  it("deletes a bundled (server-listed) voice on the server without touching local clips", async () => {
    const { removeVoice, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({ tts_base_url: "http://localhost:8091" }),
      log: noopLog,
      broadcastSettings: () => {},
    });
    speakerSelection.setManifest({
      available: [{ id: "natsume", label: "natsume", ref_url: "" }],
      defaultValue: "natsume",
    });

    await removeVoice("natsume");

    expect(deleteVoice).toHaveBeenCalledWith(expect.objectContaining({ id: "natsume" }));
    expect(removeUserVoiceMock).not.toHaveBeenCalled();
    speakerSelection.dispose();
  });

  it("does not delete the local reference clip when the server delete fails", async () => {
    deleteVoice.mockRejectedValue(new Error("server down"));
    const { removeVoice, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({ tts_base_url: "http://localhost:8091" }),
      log: noopLog,
      broadcastSettings: () => {},
    });

    await expect(removeVoice("myvoice")).rejects.toThrow("server down");

    expect(removeUserVoiceMock).not.toHaveBeenCalled();
    speakerSelection.dispose();
  });
});

describe("wireBroker", () => {
  beforeEach(() => {
    brokerClient.publish.mockClear();
    brokerClient.start.mockClear();
    brokerClient.dispose.mockClear();
    createBrokerClient.mockClear();
    deriveBrokerPayload.mockClear();
    vi.mocked(loadEmotionTextTable).mockClear();
  });

  // wireBroker fires publish().then(start) fire-and-forget — drain the microtask queue to observe it.
  const flush = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
  };

  const makeDeps = (endpoints: Record<string, unknown>) => {
    const unsub = vi.fn();
    const endpointsSettings = { subscribe: vi.fn(() => unsub) };
    const unsubExpress = vi.fn();
    // Minimal express-motion store: the wiring only reads it and reacts to its notifications.
    let notify: () => void = () => {};
    const expressMotionSettings = {
      get: () => ({ disabled: [] as string[] }),
      subscribe: vi.fn((cb: () => void) => {
        notify = cb;
        return unsubExpress;
      }),
    };
    return {
      deps: {
        getConfig: () => ({ emotionRegistry: {}, motions: {}, endpoints: {} }) as never,
        getEndpoints: () => endpoints as never,
        endpointsSettings,
        expressMotionSettings,
        log: noopLog,
      },
      unsub,
      unsubExpress,
      changeExpressMotions: () => notify(),
    };
  };

  it("publishes then starts when broker_base_url is present", async () => {
    const { deps } = makeDeps({ broker_base_url: "http://localhost:3201" });
    await wireBroker(deps);
    expect(createBrokerClient).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "http://localhost:3201" }),
    );
    expect(brokerClient.publish).toHaveBeenCalledTimes(1);
    await flush();
    expect(brokerClient.start).toHaveBeenCalledTimes(1);
  });

  // The emoji enum table is the only emotion_text vocabulary — nothing gates its load.
  it("always loads the emoji emotion_text table", async () => {
    const { deps } = makeDeps({ broker_base_url: "http://localhost:3201" });
    await wireBroker(deps);
    expect(vi.mocked(loadEmotionTextTable)).toHaveBeenCalledWith({ provider: "irodori" });
  });

  it("degrades to a null table when the emotion_text load fails, without throwing into boot", async () => {
    vi.mocked(loadEmotionTextTable).mockRejectedValueOnce(new Error("missing file"));
    const { deps } = makeDeps({ broker_base_url: "http://localhost:3201" });
    const handle = await wireBroker(deps);
    deriveBrokerPayload.mockClear();

    handle.vocabulary();

    expect(deriveBrokerPayload).toHaveBeenCalledWith(expect.anything(), null, expect.anything());
  });

  it("does nothing when broker_base_url is empty", async () => {
    const { deps } = makeDeps({ broker_base_url: "" });
    await wireBroker(deps);
    expect(createBrokerClient).not.toHaveBeenCalled();
    expect(brokerClient.publish).not.toHaveBeenCalled();
  });

  it("re-publishes only on config sections that change renderable vocab", async () => {
    const { deps } = makeDeps({ broker_base_url: "http://localhost:3201" });
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

  it("vocabulary() derives from the live config and the loaded emotion_text table", async () => {
    vi.mocked(loadEmotionTextTable).mockResolvedValueOnce({ "🤭": "Giggle" });
    const { deps } = makeDeps({ broker_base_url: "http://localhost:3201" });
    const handle = await wireBroker(deps);
    deriveBrokerPayload.mockClear();

    handle.vocabulary();

    expect(deriveBrokerPayload).toHaveBeenCalledWith(
      expect.anything(),
      { "🤭": "Giggle" },
      expect.anything(),
    );
  });

  it("loads the emotion_text table with no broker configured — the vocabulary still feeds the client tools", async () => {
    vi.mocked(loadEmotionTextTable).mockResolvedValueOnce({ "🤭": "Giggle" });
    const { deps } = makeDeps({ broker_base_url: "" });
    const handle = await wireBroker(deps);
    deriveBrokerPayload.mockClear();

    handle.vocabulary();

    expect(vi.mocked(loadEmotionTextTable)).toHaveBeenCalledTimes(1);
    expect(deriveBrokerPayload).toHaveBeenCalledWith(
      expect.anything(),
      { "🤭": "Giggle" },
      expect.anything(),
    );
  });

  it("re-publishes when the expression-motion selection changes", async () => {
    const { deps, changeExpressMotions } = makeDeps({ broker_base_url: "http://localhost:3201" });
    await wireBroker(deps);
    await flush();
    brokerClient.publish.mockClear();

    changeExpressMotions();
    await flush();

    expect(brokerClient.publish).toHaveBeenCalledTimes(1);
  });

  it("skips the selection re-publish when no broker is configured", async () => {
    const { deps, changeExpressMotions } = makeDeps({ broker_base_url: "" });
    await wireBroker(deps);
    await flush();

    changeExpressMotions();
    await flush();

    expect(brokerClient.publish).not.toHaveBeenCalled();
  });

  it("derives the vocabulary against the live expression-motion selection", async () => {
    const { deps } = makeDeps({ broker_base_url: "http://localhost:3201" });
    const handle = await wireBroker(deps);
    deriveBrokerPayload.mockClear();

    handle.vocabulary();

    expect(deriveBrokerPayload).toHaveBeenCalledWith(
      expect.anything(),
      null,
      expect.objectContaining({ expressMotions: { disabled: [] } }),
    );
  });

  it("dispose unsubscribes the override listener and disposes the client", async () => {
    const { deps, unsub, unsubExpress } = makeDeps({ broker_base_url: "http://localhost:3201" });
    const handle = await wireBroker(deps);
    handle.dispose();
    expect(unsub).toHaveBeenCalledTimes(1);
    expect(unsubExpress).toHaveBeenCalledTimes(1);
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

describe("wireWindowSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fakeBridge.onSettingsChanged.mockClear();
    fakeBridge.emitSettingsChanged.mockClear();
    fakeBridge.dispose.mockClear();
    createSettingsBridge.mockClear();
    wireStorageSync.mockClear();
    wireStorageSyncDispose.mockClear();
    vi.mocked(reloadLocaleFromStorage).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(reloadLocaleFromStorage).mockReset();
  });

  // In-memory pub/sub shared by real bridges, so envelopes cross windows for real.
  const createFakeTransport = (): BridgeTransport => {
    const listeners = new Map<string, Set<(p: unknown) => void>>();
    return {
      emit(name, payload) {
        for (const cb of [...(listeners.get(name) ?? [])]) cb(payload);
      },
      listen(name, cb) {
        let set = listeners.get(name);
        if (!set) {
          set = new Set();
          listeners.set(name, set);
        }
        set.add(cb);
        return () => set!.delete(cb);
      },
    };
  };

  // Minimal store bag covering one key of each SYNC_MODE, recording reload order by label.
  const makeBag = (order: string[]) => {
    const subscribers = new Map<string, () => void>();
    const store = (label: string) => ({
      subscribe: vi.fn((cb: () => void) => {
        subscribers.set(label, cb);
        return vi.fn();
      }),
      reloadFromStorage: vi.fn(() => {
        order.push(label);
        subscribers.get(label)?.();
      }),
    });
    return {
      bag: { ttsSettings: store("broadcast"), contextHistory: store("reload") },
      subscribers,
    };
  };

  const makeLog = () => ({ info: vi.fn(), warn: () => {}, error: () => {}, debug: () => {} });

  const sourcesLogged = (log: ReturnType<typeof makeLog>): string[] =>
    log.info.mock.calls
      .filter(([event]) => event === "settings_change_received")
      .map(([, fields]) => (fields as { source: string }).source);

  const receiver = (): ((from: string) => void) =>
    (fakeBridge.onSettingsChanged.mock.calls as unknown as Array<[(from: string) => void]>)[0]![0];

  it("logs each remote change against the window kind that sent it", async () => {
    const bridgeModule =
      await vi.importActual<typeof import("./io/settings-bridge")>("./io/settings-bridge");
    const transport = createFakeTransport();
    createSettingsBridge.mockImplementationOnce(((_transport: unknown, opts: never) =>
      bridgeModule.createSettingsBridge(transport, opts)) as never);
    const order: string[] = [];
    const { bag } = makeBag(order);
    const log = makeLog();
    const sync = wireWindowSync({ stores: bag as never, windowKind: "pet", log } as never);

    bridgeModule.createSettingsBridge(transport, { windowKind: "settings" }).emitSettingsChanged();
    bridgeModule.createSettingsBridge(transport, { windowKind: "devtools" }).emitSettingsChanged();

    expect(sourcesLogged(log)).toEqual(["settings", "devtools"]);
    sync.dispose();
  });

  it("reloads the registry set, then the extra resync stores, then the display language", () => {
    const order: string[] = [];
    const { bag } = makeBag(order);
    const extra = [{ reloadFromStorage: vi.fn(() => order.push("extra")) }];
    vi.mocked(reloadLocaleFromStorage).mockImplementation(() => order.push("locale"));
    const sync = wireWindowSync({
      stores: bag as never,
      windowKind: "settings",
      extraResync: extra,
      log: noopLog,
    });

    sync.reload();

    expect(order).toEqual(["broadcast", "reload", "extra", "locale"]);
    sync.dispose();
  });

  it("runs the reload and every remote hook under the loop guard", () => {
    const order: string[] = [];
    const { bag } = makeBag(order);
    const hook = vi.fn(() => order.push("hook"));
    const sync = wireWindowSync({ stores: bag as never, windowKind: "devtools", log: noopLog });
    sync.onRemoteChange(hook);

    receiver()("settings");
    vi.advanceTimersByTime(201);

    expect(order).toEqual(["broadcast", "reload", "hook"]);
    expect(fakeBridge.emitSettingsChanged).not.toHaveBeenCalled();
    sync.dispose();
  });

  it("runs a storage-event-driven reload under the same loop guard as the bridge path", () => {
    const order: string[] = [];
    const { bag } = makeBag(order);
    const sync = wireWindowSync({ stores: bag as never, windowKind: "devtools", log: noopLog });

    // wireStorageSync is mocked (module-level vi.mock above) — it never installs a real
    // "storage" listener. Simulate the sibling window's storage event by invoking whatever
    // wireWindowSync handed it, the same way the real "storage" listener would.
    const storageReloadArg = wireStorageSync.mock.calls[0]![0]!;
    for (const entry of storageReloadArg) entry.reloadFromStorage();
    vi.advanceTimersByTime(201);

    // Scope is pinned to what the storage path reloaded before this fix: the resync
    // stores only — no display-language reload, no onRemoteChange hooks.
    expect(order).toEqual(["broadcast", "reload"]);
    expect(reloadLocaleFromStorage).not.toHaveBeenCalled();
    expect(fakeBridge.emitSettingsChanged).not.toHaveBeenCalled();
    sync.dispose();
  });

  it("runs a hook registered after construction on the next remote change", () => {
    const order: string[] = [];
    const { bag } = makeBag(order);
    const sync = wireWindowSync({ stores: bag as never, windowKind: "devtools", log: noopLog });
    const receive = receiver();

    receive("settings");
    const late = vi.fn();
    sync.onRemoteChange(late);
    receive("settings");

    expect(late).toHaveBeenCalledTimes(1);
    sync.dispose();
  });

  it("disposes once and flushes a pending broadcast before the bridge closes", () => {
    const order: string[] = [];
    const { bag, subscribers } = makeBag(order);
    const sync = wireWindowSync({ stores: bag as never, windowKind: "devtools", log: noopLog });
    const disposeSettingsChanged = fakeBridge.onSettingsChanged.mock.results[0]!
      .value as ReturnType<typeof vi.fn>;
    subscribers.get("broadcast")!();

    sync.dispose();
    sync.dispose();

    expect(wireStorageSyncDispose).toHaveBeenCalledOnce();
    expect(fakeBridge.emitSettingsChanged).toHaveBeenCalledOnce();
    expect(disposeSettingsChanged).toHaveBeenCalledOnce();
    expect(fakeBridge.dispose).toHaveBeenCalledOnce();
  });
});

describe("wireCrossWindowSync", () => {
  beforeEach(() => {
    fakeBridge.onMouthPreview.mockClear();
    fakeBridge.onVoiceSet.mockClear();
    fakeBridge.emitVoiceState.mockClear();
    fakeBridge.dispose.mockClear();
    createSettingsBridge.mockClear();
    wireStorageSync.mockClear();
    wireStorageSyncDispose.mockClear();
  });

  const makeDeps = () => {
    const renderer = { setMouthOpen: vi.fn(), stopMouth: vi.fn() };
    const voiceInputStatus = createVoiceInputStatus();
    const log = { info: vi.fn(), warn: () => {}, error: () => {}, debug: () => {} };
    const stores = createSettingsStores();
    return { renderer, voiceInputStatus, log, stores };
  };

  const teardown = (deps: ReturnType<typeof makeDeps>) => {
    for (const store of Object.values(deps.stores)) store.dispose();
  };

  it("wires storage sync to reload exactly the stores classified for reload", () => {
    const deps = makeDeps();
    const allStores = Object.values(deps.stores) as SyncedStore[];
    const reloadSpies = allStores.map((store) => vi.spyOn(store, "reloadFromStorage"));
    wireCrossWindowSync(deps as never);

    // wireStorageSync is mocked — invoke whatever it was handed the way a real "storage"
    // event would, and check it reloaded exactly the expected stores (no more, no less).
    for (const entry of wireStorageSync.mock.calls[0]![0]!) entry.reloadFromStorage();

    const reloadedStores = new Set(
      allStores.filter((_store, index) => reloadSpies[index]!.mock.calls.length > 0),
    );
    const expectedStores = new Set(reloadSyncStores(deps.stores));
    expect(reloadedStores.size).toBe(expectedStores.size);
    expect(reloadedStores).toEqual(expectedStores);
    for (const spy of reloadSpies) spy.mockRestore();
    teardown(deps);
  });

  it("routes mouth preview to the renderer", () => {
    const deps = makeDeps();
    wireCrossWindowSync(deps as never);
    const onMouthPreview = fakeBridge.onMouthPreview.mock.calls[0][0] as (v: number | null) => void;
    onMouthPreview(0.5);
    expect(deps.renderer.setMouthOpen).toHaveBeenCalledWith(0.5);
    onMouthPreview(null);
    expect(deps.renderer.stopMouth).toHaveBeenCalledTimes(1);
    teardown(deps);
  });

  it("routes the voice toggle to voiceInputStatus and logs it", () => {
    const deps = makeDeps();
    wireCrossWindowSync(deps as never);
    const onVoiceSet = fakeBridge.onVoiceSet.mock.calls[0][0] as (on: boolean) => void;
    onVoiceSet(true);
    expect(deps.voiceInputStatus.get().state).toBe("listening");
    expect(deps.log.info).toHaveBeenCalledWith(
      "voice_toggle_received",
      expect.objectContaining({ on: true }),
    );
    onVoiceSet(false);
    expect(deps.voiceInputStatus.get().state).toBe("idle");
    teardown(deps);
  });

  it("publishes voice status changes through the bridge", () => {
    const deps = makeDeps();
    wireCrossWindowSync(deps as never);
    deps.voiceInputStatus.set("listening");
    expect(fakeBridge.emitVoiceState).toHaveBeenCalledWith({ state: "listening" });
    teardown(deps);
  });

  it("dispose tears down storage sync and the bridge", () => {
    const deps = makeDeps();
    const { dispose } = wireCrossWindowSync(deps as never);
    dispose();
    expect(wireStorageSyncDispose).toHaveBeenCalledTimes(1);
    expect(fakeBridge.dispose).toHaveBeenCalledTimes(1);
    teardown(deps);
  });

  it("creates the bridge as the pet window", () => {
    const deps = makeDeps();
    wireCrossWindowSync(deps as never);
    expect(createSettingsBridge).toHaveBeenCalledWith(undefined, { windowKind: "pet" });
    teardown(deps);
  });
});

describe("wireSettingsWindowSync", () => {
  beforeEach(() => {
    createSettingsBridge.mockClear();
    wireStorageSync.mockClear();
  });

  const makeDeps = () => ({
    stores: createSettingsStores(),
    vrmSelection: { reloadFromStorage: vi.fn() },
    speakerSelection: { reloadFromStorage: vi.fn() },
    log: noopLog,
  });

  const teardown = (deps: ReturnType<typeof makeDeps>) => {
    for (const store of Object.values(deps.stores)) store.dispose();
  };

  it("resyncs the vrm and speaker selections alongside the reload set", () => {
    const deps = makeDeps();
    const allStores = Object.values(deps.stores) as SyncedStore[];
    const reloadSpies = allStores.map((store) => vi.spyOn(store, "reloadFromStorage"));
    wireSettingsWindowSync(deps);

    for (const entry of wireStorageSync.mock.calls[0]![0]!) entry.reloadFromStorage();

    const reloadedStores = new Set(
      allStores.filter((_store, index) => reloadSpies[index]!.mock.calls.length > 0),
    );
    const expectedStores = new Set(reloadSyncStores(deps.stores));
    expect(reloadedStores.size).toBe(expectedStores.size);
    expect(reloadedStores).toEqual(expectedStores);
    expect(deps.vrmSelection.reloadFromStorage).toHaveBeenCalledOnce();
    expect(deps.speakerSelection.reloadFromStorage).toHaveBeenCalledOnce();
    for (const spy of reloadSpies) spy.mockRestore();
    teardown(deps);
  });

  it("creates the bridge as the settings window", () => {
    const deps = makeDeps();
    wireSettingsWindowSync(deps);
    expect(createSettingsBridge).toHaveBeenCalledWith(undefined, { windowKind: "settings" });
    teardown(deps);
  });
});

describe("wireDevtoolsSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fakeBridge.onSettingsChanged.mockClear();
    fakeBridge.emitSettingsChanged.mockClear();
    fakeBridge.dispose.mockClear();
    createSettingsBridge.mockClear();
    wireStorageSync.mockClear();
    wireStorageSyncDispose.mockClear();
    vi.mocked(reloadLocaleFromStorage).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("subscribes exactly the stores classified for broadcast", () => {
    const bag = createSettingsStores();
    const allStores = Object.values(bag) as SyncedStore[];
    const subscribeSpies = allStores.map((store) => vi.spyOn(store, "subscribe"));

    const sync = wireDevtoolsSync({ stores: bag, log: noopLog });

    const subscribedStores = new Set(
      allStores.filter((_store, index) => subscribeSpies[index]!.mock.calls.length > 0),
    );
    const expectedStores = new Set(broadcastSyncStores(bag));
    expect(subscribedStores.size).toBe(expectedStores.size);
    expect(subscribedStores).toEqual(expectedStores);

    sync.dispose();
    for (const spy of subscribeSpies) spy.mockRestore();
    for (const store of Object.values(bag)) store.dispose();
  });

  it("wires storage sync to reload exactly the stores classified for reload", () => {
    const bag = createSettingsStores();
    const allStores = Object.values(bag) as SyncedStore[];
    const reloadSpies = allStores.map((store) => vi.spyOn(store, "reloadFromStorage"));

    const sync = wireDevtoolsSync({ stores: bag, log: noopLog });
    for (const entry of wireStorageSync.mock.calls[0]![0]!) entry.reloadFromStorage();

    const reloadedStores = new Set(
      allStores.filter((_store, index) => reloadSpies[index]!.mock.calls.length > 0),
    );
    const expectedStores = new Set(reloadSyncStores(bag));
    expect(reloadedStores.size).toBe(expectedStores.size);
    expect(reloadedStores).toEqual(expectedStores);

    sync.dispose();
    for (const spy of reloadSpies) spy.mockRestore();
    for (const store of Object.values(bag)) store.dispose();
  });

  it("runs a storage-event-driven reload under the loop guard without rebroadcasting", () => {
    const bag = createSettingsStores();
    const broadcastStore = broadcastSyncStores(bag)[0]!;
    let retainedSubscriber: (() => void) | undefined;
    const subscribeSpy = vi.spyOn(broadcastStore, "subscribe").mockImplementation((callback) => {
      retainedSubscriber = callback;
      return vi.fn();
    });
    const reloadSpy = vi.spyOn(broadcastStore, "reloadFromStorage").mockImplementation(() => {
      retainedSubscriber!();
    });

    const sync = wireDevtoolsSync({ stores: bag, log: noopLog });
    for (const entry of wireStorageSync.mock.calls[0]![0]!) entry.reloadFromStorage();
    vi.advanceTimersByTime(201);

    expect(reloadSpy).toHaveBeenCalledOnce();
    expect(fakeBridge.emitSettingsChanged).not.toHaveBeenCalled();

    sync.dispose();
    subscribeSpy.mockRestore();
    reloadSpy.mockRestore();
    for (const store of Object.values(bag)) store.dispose();
  });

  it("reloads every sync store without rebroadcasting a remote change", () => {
    const bag = createSettingsStores();
    const reloadStores = reloadSyncStores(bag);
    const broadcastStore = broadcastSyncStores(bag)[0]!;
    let retainedSubscriber: (() => void) | undefined;
    const subscribeSpy = vi.spyOn(broadcastStore, "subscribe").mockImplementation((callback) => {
      retainedSubscriber = callback;
      return vi.fn();
    });
    const reloadSpies = reloadStores.map((store) => vi.spyOn(store, "reloadFromStorage"));
    const broadcastReloadIndex = reloadStores.indexOf(broadcastStore);
    reloadSpies[broadcastReloadIndex]!.mockImplementation(() => retainedSubscriber!());
    const sync = wireDevtoolsSync({ stores: bag, log: noopLog });
    const settingsChangedCalls = fakeBridge.onSettingsChanged.mock.calls as unknown as Array<
      [() => void]
    >;
    const receiveSettingsChanged = settingsChangedCalls[0]![0];

    receiveSettingsChanged();
    vi.advanceTimersByTime(201);

    for (const spy of reloadSpies) expect(spy).toHaveBeenCalledOnce();
    expect(reloadLocaleFromStorage).toHaveBeenCalledOnce();
    expect(fakeBridge.emitSettingsChanged).not.toHaveBeenCalled();

    sync.dispose();
    subscribeSpy.mockRestore();
    for (const spy of reloadSpies) spy.mockRestore();
    for (const store of Object.values(bag)) store.dispose();
  });

  it("disposes once and flushes a pending broadcast before the bridge closes", () => {
    const bag = createSettingsStores();
    const broadcastStore = broadcastSyncStores(bag)[0]!;
    let retainedSubscriber: (() => void) | undefined;
    const subscribeSpy = vi.spyOn(broadcastStore, "subscribe").mockImplementation((callback) => {
      retainedSubscriber = callback;
      return vi.fn();
    });
    const sync = wireDevtoolsSync({ stores: bag, log: noopLog });
    const disposeSettingsChanged = fakeBridge.onSettingsChanged.mock.results[0]!
      .value as ReturnType<typeof vi.fn>;
    retainedSubscriber!();

    sync.dispose();
    sync.dispose();

    expect(wireStorageSyncDispose).toHaveBeenCalledOnce();
    expect(fakeBridge.emitSettingsChanged).toHaveBeenCalledOnce();
    expect(disposeSettingsChanged).toHaveBeenCalledOnce();
    expect(fakeBridge.dispose).toHaveBeenCalledOnce();

    subscribeSpy.mockRestore();
    for (const store of Object.values(bag)) store.dispose();
  });
});

describe("wireDevGlobals", () => {
  afterEach(() => {
    for (const key of [
      "__yuiRenderer",
      "__yuiAmbient",
      "__yuiSurfaces",
      "__yuiMock",
      "__yuiScreenshot",
      "__yuiLipsync",
      "__yuiAgent",
      "__yuiQuick",
      "__yuiVoiceInputStatus",
      "__yui_send",
      "__yui_dispatcher",
      "__yui_windowSit",
      "__yuiDemo",
    ]) {
      delete (globalThis as Record<string, unknown>)[key];
    }
    createMockDriver.mockClear();
  });

  const makeDeps = () => {
    const dispatcher = { id: "dispatcher" };
    return {
      renderer: { id: "renderer" },
      ambient: { trigger: vi.fn() },
      surfaces: { summonInput: vi.fn(), showTool: vi.fn() },
      screenshotSettings: { id: "screenshot" },
      lipsyncSettings: { id: "lipsync" },
      agentSettings: { id: "agent" },
      quickControls: { id: "quick" },
      voiceInputStatus: createVoiceInputStatus(),
      userInput: { submit: vi.fn() },
      bus: { push: vi.fn() },
      getDispatcher: () => dispatcher,
    };
  };

  it("installs debug globals referencing the live instances", async () => {
    const deps = makeDeps();
    await wireDevGlobals(deps as never);
    const g = globalThis as Record<string, unknown>;
    expect(g.__yuiRenderer).toBe(deps.renderer);
    expect(g.__yuiSurfaces).toBe(deps.surfaces);
    expect(g.__yuiMock).toBe(mockDriver);
    expect(g.__yuiQuick).toBe(deps.quickControls);
    expect((g.__yui_dispatcher as () => unknown)()).toEqual({ id: "dispatcher" });
  });

  it("__yui_send submits text through userInput", async () => {
    const deps = makeDeps();
    await wireDevGlobals(deps as never);
    (globalThis as unknown as Record<string, (text: string) => void>).__yui_send("hello");
    expect(deps.userInput.submit).toHaveBeenCalledWith("hello");
  });

  it("__yui_windowSit.enter pushes a window_sit_enter event", async () => {
    const deps = makeDeps();
    await wireDevGlobals(deps as never);
    const windowSit = (globalThis as unknown as Record<string, { enter: () => void }>)
      .__yui_windowSit;
    windowSit.enter();
    expect(deps.bus.push).toHaveBeenCalledWith(
      expect.objectContaining({ event_name: "user.window_sit_enter" }),
    );
  });

  it("__yuiDemo.tap triggers the ambient cue", async () => {
    const deps = makeDeps();
    await wireDevGlobals(deps as never);
    const demo = (globalThis as unknown as Record<string, { tap: () => void }>).__yuiDemo;
    demo.tap();
    expect(deps.ambient.trigger).toHaveBeenCalledWith("tap_react");
  });
});

describe("wireGuardrailsOverrides", () => {
  const inMemoryStorage = () => {
    let value: { tier2_max: number; tier3_max: number; overall_max: number } | null = null;
    return {
      load: () => (value ? { ...value } : null),
      save: (s: { tier2_max: number; tier3_max: number; overall_max: number }) => {
        value = { ...s };
      },
    };
  };

  function baseConfig(): GuardrailsConfig {
    return {
      debounce_ms: {
        idle_watcher: 0,
        os_event_watcher: 0,
        backend_push_source: 0,
        user_input_source: 0,
        screen_watcher: 0,
      },
      rate_limit: {
        window_ms: 3_600_000,
        tier2_max: 2,
        tier3_max: 2,
        overall_max: 100,
        cooldown_ms: 300_000,
      },
      attachments: { max_count: 6, max_image_bytes: 5_242_880 },
    };
  }

  const fire = (guardrails: ReturnType<typeof createGuardrails>): boolean =>
    guardrails.evaluate(
      { source: "idle_watcher", event_name: "idle.long", ts: 1_717_000_000_000 },
      2,
    ).pass;

  function setup() {
    const config = baseConfig();
    const store = createGuardrailsSettings({ storage: inMemoryStorage() });
    const getGuardrails = (): GuardrailsConfig => mergeGuardrails(config, store.get());
    const guardrails = createGuardrails(getGuardrails(), { now: () => 1_717_000_000_000 });
    const dispose = wireGuardrailsOverrides({ guardrails, store, getGuardrails });
    return { guardrails, store, dispose };
  }

  it("re-caps the live limiter when a cap is edited", () => {
    const { guardrails, store, dispose } = setup();
    expect(fire(guardrails)).toBe(true);
    expect(fire(guardrails)).toBe(true);
    expect(fire(guardrails)).toBe(false);

    store.set({ tier2_max: 4 });
    expect(fire(guardrails)).toBe(true);
    dispose();
  });

  it("keeps the rolling counters when a cap is edited", () => {
    const { guardrails, store, dispose } = setup();
    // Two slots consumed under the config default of 2.
    expect(fire(guardrails)).toBe(true);
    expect(fire(guardrails)).toBe(true);

    // Raising the cap to 4 leaves exactly two slots — a counter reset would refill all four.
    store.set({ tier2_max: 4 });
    expect(fire(guardrails)).toBe(true);
    expect(fire(guardrails)).toBe(true);
    expect(fire(guardrails)).toBe(false);
    dispose();
  });

  it("stops applying edits after dispose", () => {
    const { guardrails, store, dispose } = setup();
    dispose();
    store.set({ tier2_max: 4 });
    expect(fire(guardrails)).toBe(true);
    expect(fire(guardrails)).toBe(true);
    expect(fire(guardrails)).toBe(false);
  });
});
