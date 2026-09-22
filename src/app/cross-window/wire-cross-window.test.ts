import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// i18n is a side-effecting singleton; stub it so the settings-sync tests stay isolated.
const { unsubscribeLocale } = vi.hoisted(() => ({ unsubscribeLocale: vi.fn() }));

vi.mock("../../ui/i18n", () => ({
  subscribe: () => unsubscribeLocale,
  reloadFromStorage: vi.fn(),
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

vi.mock("../../io/bridge/settings-bridge", () => ({ createSettingsBridge }));

const { wireStorageSyncDispose, wireStorageSync } = vi.hoisted(() => {
  const wireStorageSyncDispose = vi.fn();
  // Typed so `.mock.calls[0][0]` is the ReadonlyArray<{ reloadFromStorage() }> wireWindowSync
  // hands it, not an untyped `[]` — an untyped vi.fn() infers a zero-arity call signature.
  const wireStorageSync = vi.fn(
    (_stores: ReadonlyArray<{ reloadFromStorage(): void }>) => wireStorageSyncDispose,
  );
  return { wireStorageSyncDispose, wireStorageSync };
});

vi.mock("../../io/window/openers/settings-window", () => ({ wireStorageSync }));

const { mockDriver, createMockDriver } = vi.hoisted(() => {
  const mockDriver = { reply: vi.fn(), proactive: vi.fn(), speak: vi.fn() };
  return { mockDriver, createMockDriver: vi.fn(() => mockDriver) };
});

vi.mock("../../ui/surfaces/mock", () => ({ createMockDriver }));

import {
  broadcastSyncStores,
  createSettingsStores,
  reloadSyncStores,
  type SyncedStore,
} from "../../settings/settings-stores";
import { createVoiceInputStatus } from "../../ui/chips/voice-input-status";
import { reloadFromStorage as reloadLocaleFromStorage } from "../../ui/i18n";
import { createConversationStores } from "../settings/conversation-stores";
import {
  wireCrossWindowSync,
  wireDevGlobals,
  wireDevtoolsSync,
  wireSettingsWindowSync,
} from "./wire-cross-window";

const noopLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

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
    const conversation = createConversationStores();
    return { renderer, voiceInputStatus, log, stores, conversation };
  };

  const teardown = (deps: ReturnType<typeof makeDeps>) => {
    for (const store of Object.values(deps.stores)) store.dispose();
    for (const store of Object.values(deps.conversation)) store.dispose();
  };

  it("wires storage sync to reload exactly the stores classified for reload", () => {
    const deps = makeDeps();
    const allStores = [
      ...Object.values(deps.stores),
      ...Object.values(deps.conversation),
    ] as SyncedStore[];
    const reloadSpies = allStores.map((store) => vi.spyOn(store, "reloadFromStorage"));
    wireCrossWindowSync(deps as never);

    // wireStorageSync is mocked — invoke whatever it was handed the way a real "storage"
    // event would, and check it reloaded exactly the expected stores (no more, no less).
    for (const entry of wireStorageSync.mock.calls[0]![0]!) entry.reloadFromStorage();

    const reloadedStores = new Set(
      allStores.filter((_store, index) => reloadSpies[index]!.mock.calls.length > 0),
    );
    const expectedStores = new Set([
      ...reloadSyncStores(deps.stores),
      ...Object.values(deps.conversation),
    ]);
    expect(reloadedStores.size).toBe(expectedStores.size);
    expect(reloadedStores).toEqual(expectedStores);
    for (const spy of reloadSpies) spy.mockRestore();
    teardown(deps);
  });

  it("subscribes the settings broadcast set plus only the conversation chat history", () => {
    const deps = makeDeps();
    const allStores = [
      ...Object.values(deps.stores),
      ...Object.values(deps.conversation),
    ] as SyncedStore[];
    const subscribeSpies = allStores.map((store) => vi.spyOn(store, "subscribe"));
    wireCrossWindowSync(deps as never);

    const subscribedStores = new Set(
      allStores.filter((_store, index) => subscribeSpies[index]!.mock.calls.length > 0),
    );
    const expectedStores = new Set([
      ...broadcastSyncStores(deps.stores),
      deps.conversation.chatHistoryStore,
    ]);
    expect(subscribedStores.size).toBe(expectedStores.size);
    expect(subscribedStores).toEqual(expectedStores);

    for (const spy of subscribeSpies) spy.mockRestore();
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
    conversation: createConversationStores(),
    vrmSelection: { reloadFromStorage: vi.fn() },
    speakerSelection: { reloadFromStorage: vi.fn() },
    log: noopLog,
  });

  const teardown = (deps: ReturnType<typeof makeDeps>) => {
    for (const store of Object.values(deps.stores)) store.dispose();
    for (const store of Object.values(deps.conversation)) store.dispose();
  };

  it("subscribes the settings broadcast set plus only the conversation chat history", () => {
    const deps = makeDeps();
    const allStores = [
      ...Object.values(deps.stores),
      ...Object.values(deps.conversation),
    ] as SyncedStore[];
    const subscribeSpies = allStores.map((store) => vi.spyOn(store, "subscribe"));

    const sync = wireSettingsWindowSync(deps);

    const subscribedStores = new Set(
      allStores.filter((_store, index) => subscribeSpies[index]!.mock.calls.length > 0),
    );
    const expectedStores = new Set([
      ...broadcastSyncStores(deps.stores),
      deps.conversation.chatHistoryStore,
    ]);
    expect(subscribedStores.size).toBe(expectedStores.size);
    expect(subscribedStores).toEqual(expectedStores);

    sync.dispose();
    for (const spy of subscribeSpies) spy.mockRestore();
    teardown(deps);
  });

  it("resyncs the vrm and speaker selections alongside the reload set", () => {
    const deps = makeDeps();
    const allStores = [
      ...Object.values(deps.stores),
      ...Object.values(deps.conversation),
    ] as SyncedStore[];
    const reloadSpies = allStores.map((store) => vi.spyOn(store, "reloadFromStorage"));
    wireSettingsWindowSync(deps);

    for (const entry of wireStorageSync.mock.calls[0]![0]!) entry.reloadFromStorage();

    const reloadedStores = new Set(
      allStores.filter((_store, index) => reloadSpies[index]!.mock.calls.length > 0),
    );
    const expectedStores = new Set([
      ...reloadSyncStores(deps.stores),
      ...Object.values(deps.conversation),
    ]);
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

  const makeBags = () => ({
    bag: createSettingsStores(),
    conversation: createConversationStores(),
  });

  const teardown = (bags: ReturnType<typeof makeBags>) => {
    for (const store of Object.values(bags.bag)) store.dispose();
    for (const store of Object.values(bags.conversation)) store.dispose();
  };

  it("subscribes the settings broadcast set plus only the conversation chat history", () => {
    const { bag, conversation } = makeBags();
    const allStores = [...Object.values(bag), ...Object.values(conversation)] as SyncedStore[];
    const subscribeSpies = allStores.map((store) => vi.spyOn(store, "subscribe"));

    const sync = wireDevtoolsSync({ stores: bag, conversation, log: noopLog });

    const subscribedStores = new Set(
      allStores.filter((_store, index) => subscribeSpies[index]!.mock.calls.length > 0),
    );
    const expectedStores = new Set([...broadcastSyncStores(bag), conversation.chatHistoryStore]);
    expect(subscribedStores.size).toBe(expectedStores.size);
    expect(subscribedStores).toEqual(expectedStores);

    sync.dispose();
    for (const spy of subscribeSpies) spy.mockRestore();
    teardown({ bag, conversation });
  });

  it("wires storage sync to reload exactly the stores classified for reload", () => {
    const { bag, conversation } = makeBags();
    const allStores = [...Object.values(bag), ...Object.values(conversation)] as SyncedStore[];
    const reloadSpies = allStores.map((store) => vi.spyOn(store, "reloadFromStorage"));

    const sync = wireDevtoolsSync({ stores: bag, conversation, log: noopLog });
    for (const entry of wireStorageSync.mock.calls[0]![0]!) entry.reloadFromStorage();

    const reloadedStores = new Set(
      allStores.filter((_store, index) => reloadSpies[index]!.mock.calls.length > 0),
    );
    const expectedStores = new Set([...reloadSyncStores(bag), ...Object.values(conversation)]);
    expect(reloadedStores.size).toBe(expectedStores.size);
    expect(reloadedStores).toEqual(expectedStores);

    sync.dispose();
    for (const spy of reloadSpies) spy.mockRestore();
    teardown({ bag, conversation });
  });

  it("runs a storage-event-driven reload under the loop guard without rebroadcasting", () => {
    const { bag, conversation } = makeBags();
    // chatHistoryStore is the conversation store that broadcasts: its reload notifies, and the
    // storage path must not let that notification re-emit a settings change.
    const historyStore: SyncedStore = conversation.chatHistoryStore;
    let retainedSubscriber: (() => void) | undefined;
    const subscribeSpy = vi.spyOn(historyStore, "subscribe").mockImplementation((callback) => {
      retainedSubscriber = callback;
      return vi.fn();
    });
    const reloadSpy = vi.spyOn(historyStore, "reloadFromStorage").mockImplementation(() => {
      retainedSubscriber!();
    });

    const sync = wireDevtoolsSync({ stores: bag, conversation, log: noopLog });
    for (const entry of wireStorageSync.mock.calls[0]![0]!) entry.reloadFromStorage();
    vi.advanceTimersByTime(201);

    expect(reloadSpy).toHaveBeenCalledOnce();
    expect(fakeBridge.emitSettingsChanged).not.toHaveBeenCalled();

    sync.dispose();
    subscribeSpy.mockRestore();
    reloadSpy.mockRestore();
    teardown({ bag, conversation });
  });

  it("reloads every sync store without rebroadcasting a remote change", () => {
    const { bag, conversation } = makeBags();
    const reloadStores = [...reloadSyncStores(bag), ...Object.values(conversation)];
    const historyStore: SyncedStore = conversation.chatHistoryStore;
    let retainedSubscriber: (() => void) | undefined;
    const subscribeSpy = vi.spyOn(historyStore, "subscribe").mockImplementation((callback) => {
      retainedSubscriber = callback;
      return vi.fn();
    });
    const reloadSpies = reloadStores.map((store) => vi.spyOn(store, "reloadFromStorage"));
    const historyReloadIndex = reloadStores.indexOf(historyStore);
    reloadSpies[historyReloadIndex]!.mockImplementation(() => retainedSubscriber!());
    const sync = wireDevtoolsSync({ stores: bag, conversation, log: noopLog });
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
    teardown({ bag, conversation });
  });

  it("disposes once and flushes a pending broadcast before the bridge closes", () => {
    const { bag, conversation } = makeBags();
    const historyStore: SyncedStore = conversation.chatHistoryStore;
    let retainedSubscriber: (() => void) | undefined;
    const subscribeSpy = vi.spyOn(historyStore, "subscribe").mockImplementation((callback) => {
      retainedSubscriber = callback;
      return vi.fn();
    });
    const sync = wireDevtoolsSync({ stores: bag, conversation, log: noopLog });
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
    teardown({ bag, conversation });
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
      "__yuiSpeech",
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
      speechPlayback: { id: "speech" },
      voiceInputStatus: createVoiceInputStatus(),
      userInput: { submit: vi.fn() },
      bus: { push: vi.fn() },
      getDispatcher: () => dispatcher,
      sitDown: vi.fn(async () => "done" as const),
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

  it("publishes the supplied speech playback as __yuiSpeech and keeps quick controls by value", async () => {
    const deps = makeDeps();
    await wireDevGlobals(deps as never);
    const g = globalThis as Record<string, unknown>;
    expect(g.__yuiSpeech).toBe(deps.speechPlayback);
    expect(g.__yuiQuick).toBe(deps.quickControls);
  });

  it("__yui_send submits text through userInput", async () => {
    const deps = makeDeps();
    await wireDevGlobals(deps as never);
    (globalThis as unknown as Record<string, (text: string) => void>).__yui_send("hello");
    expect(deps.userInput.submit).toHaveBeenCalledWith("hello");
  });

  it("__yui_windowSit.enter plays the sit-down, then pushes a window_sit_enter event", async () => {
    const deps = makeDeps();
    await wireDevGlobals(deps as never);
    const windowSit = (globalThis as unknown as Record<string, { enter: () => void }>)
      .__yui_windowSit;
    windowSit.enter();
    expect(deps.sitDown).toHaveBeenCalledTimes(1);
    expect(deps.bus.push).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(deps.bus.push).toHaveBeenCalledWith(
      expect.objectContaining({ event_name: "user.window_sit_enter" }),
    );
  });

  it("__yui_windowSit.enter pushes nothing when the sit-down is lost", async () => {
    const deps = makeDeps();
    deps.sitDown.mockResolvedValue("lost" as never);
    await wireDevGlobals(deps as never);
    const windowSit = (globalThis as unknown as Record<string, { enter: () => void }>)
      .__yui_windowSit;
    windowSit.enter();
    await Promise.resolve();
    await Promise.resolve();
    expect(deps.bus.push).not.toHaveBeenCalled();
  });

  it("__yuiDemo.tap triggers the ambient cue", async () => {
    const deps = makeDeps();
    await wireDevGlobals(deps as never);
    const demo = (globalThis as unknown as Record<string, { tap: () => void }>).__yuiDemo;
    demo.tap();
    expect(deps.ambient.trigger).toHaveBeenCalledWith("tap_react");
  });
});
