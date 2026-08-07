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

// irodori voice registry fakes — wireSpeakerSelection's refreshVoiceList exercises listVoices;
// commitVoiceImport (pick/name/copy tests below) also exercises ensureRegistered/updateVoice directly.
const { listVoices, ensureRegistered, updateVoice } = vi.hoisted(() => ({
  listVoices: vi.fn().mockResolvedValue([]),
  ensureRegistered: vi.fn().mockResolvedValue(undefined),
  updateVoice: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./io/irodori-voices", () => ({ listVoices, ensureRegistered, updateVoice }));

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
  return { wireStorageSyncDispose, wireStorageSync: vi.fn(() => wireStorageSyncDispose) };
});
vi.mock("./io/settings-window", () => ({ wireStorageSync }));
const { mockDriver, createMockDriver } = vi.hoisted(() => {
  const mockDriver = { reply: vi.fn(), proactive: vi.fn(), speak: vi.fn() };
  return { mockDriver, createMockDriver: vi.fn(() => mockDriver) };
});
vi.mock("./ui/mock", () => ({ createMockDriver }));

import {
  createSettingsBroadcast,
  showAndFocusFromSummon,
  wireBroker,
  wireCrossWindowSync,
  wireDevGlobals,
  wireDispatcherSources,
  wirePeekExitTriggers,
  wireSettingsReload,
  wireSpeakerSelection,
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
      presenceSettings: { get: () => ({ value: 5000 }) },
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
    // The dispatcher threshold is read from the presence store at creation time.
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
    let handler = (): void => {};
    const reloadStores = [{ reloadFromStorage: vi.fn() }, { reloadFromStorage: vi.fn() }];
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
      reloadStores,
      runApplyingRemote,
      vrmSelection,
      loadVrmSerialized,
      speakerSelection,
      log: noopLog,
    });
    return {
      fire: () => handler(),
      reloadStores,
      speakerSelection,
      loadVrmSerialized,
      runApplyingRemote,
    };
  };

  it("reloads every store under the loop guard on a remote change", () => {
    const s = setup({ before: "a.vrm", after: "a.vrm" });
    s.fire();
    expect(s.runApplyingRemote).toHaveBeenCalledTimes(1);
    for (const store of s.reloadStores) {
      expect(store.reloadFromStorage).toHaveBeenCalledTimes(1);
    }
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

describe("wireSpeakerSelection — refreshVoiceList", () => {
  beforeEach(() => {
    listVoices.mockReset().mockResolvedValue([]);
    selectFetch.mockClear();
  });

  it("does not call listVoices when irodori_base_url is unset", async () => {
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
        irodori_base_url: "http://localhost:8091",
        irodori_speaker: "ナツメ",
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
        irodori_base_url: "http://localhost:8091",
        irodori_speaker: "ナツメ",
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
        irodori_base_url: "http://localhost:8091",
        irodori_speaker: "ナツメ",
      }),
      log: noopLog,
      broadcastSettings: () => {},
    });

    await refreshVoiceList();

    expect(speakerSelection.list()).toEqual([]);
    expect(speakerSelection.getActiveId()).toBe("");
    speakerSelection.dispose();
  });

  it("does not select a configured irodori_speaker absent from a non-empty server list", async () => {
    listVoices.mockResolvedValue(["あやせ", "レナ"]);
    const { refreshVoiceList, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({
        irodori_base_url: "http://localhost:8091",
        irodori_speaker: "ナツメ", // configured, but the server doesn't have it
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

  it("selects the configured irodori_speaker when the server list contains it (unchanged from before)", async () => {
    listVoices.mockResolvedValue(["あやせ", "ナツメ"]);
    const { refreshVoiceList, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({
        irodori_base_url: "http://localhost:8091",
        irodori_speaker: "ナツメ",
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
        irodori_base_url: "http://localhost:8091",
        irodori_speaker: "ナツメ",
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
    ensureRegistered.mockReset().mockResolvedValue(undefined);
    updateVoice.mockReset().mockResolvedValue(undefined);
    pickVoiceFile.mockReset();
    copyVoiceFile.mockReset();
    removeOrphanVoice.mockClear();
    removeUserVoiceMock.mockReset().mockResolvedValue(undefined);
    selectFetch.mockClear();
  });

  it("pickVoiceImport returns null (cancel) without touching copyVoiceFile", async () => {
    pickVoiceFile.mockResolvedValue(null);
    const { pickVoiceImport, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({ irodori_base_url: "http://localhost:8091" }),
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
      getEndpoints: () => ({ irodori_base_url: "http://localhost:8091" }),
      log: noopLog,
      broadcastSettings: () => {},
    });

    const out = await pickVoiceImport();

    expect(out).toEqual({ srcPath: "/Users/me/Downloads/ナツメ.wav", seedName: "ナツメ" });
    speakerSelection.dispose();
  });

  it("commitVoiceImport uploads via updateVoice (PUT upserts) and commits the option to the store", async () => {
    copyVoiceFile.mockResolvedValue({
      id: "myvoice",
      label: "myvoice",
      ref_url: "asset://localhost/app-data/references/myvoice/clip.wav",
      source: "user",
    });
    const { commitVoiceImport, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({ irodori_base_url: "http://localhost:8091" }),
      log: noopLog,
      broadcastSettings: () => {},
    });

    await commitVoiceImport("/tmp/MyVoice.wav", "myvoice");

    expect(copyVoiceFile).toHaveBeenCalledWith("/tmp/MyVoice.wav", "myvoice");
    expect(updateVoice).toHaveBeenCalledOnce();
    expect(ensureRegistered).not.toHaveBeenCalled();
    expect(speakerSelection.list().map((o) => o.id)).toContain("myvoice");
    expect(speakerSelection.getActiveId()).toBe("myvoice");
    speakerSelection.dispose();
  });

  it("commitVoiceImport overwrites via updateVoice (PUT) when the server already lists the id (duplicate name)", async () => {
    copyVoiceFile.mockResolvedValue({
      id: "natsume",
      label: "natsume",
      ref_url: "asset://localhost/app-data/references/natsume/clip.wav",
      source: "user",
    });
    listVoices.mockResolvedValue(["natsume"]); // server already has this id — explicit overwrite
    const { commitVoiceImport, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({ irodori_base_url: "http://localhost:8091" }),
      log: noopLog,
      broadcastSettings: () => {},
    });

    await commitVoiceImport("/tmp/New.wav", "natsume");

    expect(updateVoice).toHaveBeenCalledOnce();
    expect(updateVoice.mock.calls[0][0]).toMatchObject({ id: "natsume" });
    expect(ensureRegistered).not.toHaveBeenCalled();
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
    updateVoice.mockRejectedValue(new Error("server down"));
    const { commitVoiceImport, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({ irodori_base_url: "http://localhost:8091" }),
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

  it("throws without copying when irodori_base_url is unset (guard before any registration)", async () => {
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

    await expect(commitVoiceImport("/tmp/MyVoice.wav", "myvoice")).rejects.toThrow(
      "irodori_base_url",
    );
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
      getEndpoints: () => ({ irodori_base_url: "http://localhost:8091" }),
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
    });
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
    const storageSyncStores = [{ reloadFromStorage: vi.fn() }];
    const syncedStores = [{ subscribe: vi.fn(() => vi.fn()), reloadFromStorage: vi.fn() }];
    return { renderer, voiceInputStatus, log, storageSyncStores, syncedStores };
  };

  it("wires storage sync with the given store list", () => {
    const deps = makeDeps();
    wireCrossWindowSync(deps as never);
    expect(wireStorageSync).toHaveBeenCalledWith(deps.storageSyncStores);
  });

  it("routes mouth preview to the renderer", () => {
    const deps = makeDeps();
    wireCrossWindowSync(deps as never);
    const onMouthPreview = fakeBridge.onMouthPreview.mock.calls[0][0] as (v: number | null) => void;
    onMouthPreview(0.5);
    expect(deps.renderer.setMouthOpen).toHaveBeenCalledWith(0.5);
    onMouthPreview(null);
    expect(deps.renderer.stopMouth).toHaveBeenCalledTimes(1);
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
  });

  it("publishes voice status changes through the bridge", () => {
    const deps = makeDeps();
    wireCrossWindowSync(deps as never);
    deps.voiceInputStatus.set("listening");
    expect(fakeBridge.emitVoiceState).toHaveBeenCalledWith({ state: "listening" });
  });

  it("dispose tears down storage sync and the bridge", () => {
    const deps = makeDeps();
    const { dispose } = wireCrossWindowSync(deps as never);
    dispose();
    expect(wireStorageSyncDispose).toHaveBeenCalledTimes(1);
    expect(fakeBridge.dispose).toHaveBeenCalledTimes(1);
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
