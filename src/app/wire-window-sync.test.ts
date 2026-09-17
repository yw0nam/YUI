import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// i18n is a side-effecting singleton; stub it so the settings-sync tests stay isolated.
const { unsubscribeLocale } = vi.hoisted(() => ({ unsubscribeLocale: vi.fn() }));

vi.mock("../ui/i18n", () => ({
  subscribe: () => unsubscribeLocale,
  reloadFromStorage: vi.fn(),
}));

// Fake bridge for wireWindowSync: the settings-changed channel these tests drive.
const { fakeBridge, createSettingsBridge } = vi.hoisted(() => {
  const fakeBridge = {
    emitSettingsChanged: vi.fn(),
    onSettingsChanged: vi.fn(() => vi.fn()),
    dispose: vi.fn(),
  };
  return { fakeBridge, createSettingsBridge: vi.fn(() => fakeBridge) };
});

vi.mock("../io/bridge/settings-bridge", () => ({ createSettingsBridge }));

const { wireStorageSyncDispose, wireStorageSync } = vi.hoisted(() => {
  const wireStorageSyncDispose = vi.fn();
  // Typed so `.mock.calls[0][0]` is the ReadonlyArray<{ reloadFromStorage() }> wireWindowSync
  // hands it, not an untyped `[]` — an untyped vi.fn() infers a zero-arity call signature.
  const wireStorageSync = vi.fn(
    (_stores: ReadonlyArray<{ reloadFromStorage(): void }>) => wireStorageSyncDispose,
  );
  return { wireStorageSyncDispose, wireStorageSync };
});

vi.mock("../io/window/settings-window", () => ({ wireStorageSync }));

import type { GuardrailsConfig } from "../config/load";
import { createGuardrails } from "../dispatcher/core/guardrails";
import type { BridgeTransport } from "../io/bridge/settings-bridge";
import { createGuardrailsSettings, mergeGuardrails } from "../io/settings/guardrails-settings";
import { reloadFromStorage as reloadLocaleFromStorage } from "../ui/i18n";
import {
  createSettingsBroadcast,
  wireGuardrailsOverrides,
  wireSettingsReload,
  wireWindowSync,
} from "./wire-window-sync";

const noopLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

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
    const bridgeModule = await vi.importActual<typeof import("../io/bridge/settings-bridge")>(
      "../io/bridge/settings-bridge",
    );
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
        os_event_watcher: 0,
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
      { source: "os_event_watcher", event_name: "proactive.head_pat", ts: 1_717_000_000_000 },
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
