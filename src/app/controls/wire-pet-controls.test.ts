// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createQuickControls,
  createCaptureIndicator,
  createVoiceInputIndicator,
  wireCueLocaleSync,
  localeSubscribers,
} = vi.hoisted(() => ({
  createQuickControls: vi.fn(),
  createCaptureIndicator: vi.fn(),
  createVoiceInputIndicator: vi.fn(),
  wireCueLocaleSync: vi.fn(),
  localeSubscribers: [] as Array<() => void>,
}));

vi.mock("../../ui/quick-controls/quick-controls", () => ({ createQuickControls }));
vi.mock("../../ui/chips/capture-indicator", () => ({ createCaptureIndicator }));
vi.mock("../../ui/chips/voice-input-indicator", () => ({ createVoiceInputIndicator }));
vi.mock("../settings/wire-cue-locale-sync", () => ({ wireCueLocaleSync }));
vi.mock("../../ui/i18n", () => ({
  subscribe: (cb: () => void) => {
    localeSubscribers.push(cb);
    return () => {
      localeSubscribers.splice(localeSubscribers.indexOf(cb), 1);
    };
  },
}));

import { createSettingsStores, type SettingsStores } from "../../settings/settings-stores";
import { createVoiceInputStatus } from "../../ui/chips/voice-input-status";
import { wirePetControls } from "./wire-pet-controls";

/** The build/dispose event trail shared by the three mocked surface factories. */
const events: string[] = [];

beforeEach(() => {
  events.length = 0;
  createQuickControls.mockImplementation(() => {
    const panel = { open: vi.fn(), dispose: vi.fn(() => void events.push("quick.dispose")) };
    events.push("quick.build");
    return panel;
  });
  createCaptureIndicator.mockImplementation(() => {
    const indicator = { dispose: vi.fn(() => void events.push("capture.dispose")) };
    events.push("capture.build");
    return indicator;
  });
  createVoiceInputIndicator.mockImplementation(() => {
    const indicator = { dispose: vi.fn(() => void events.push("voice.dispose")) };
    events.push("voice.build");
    return indicator;
  });
  wireCueLocaleSync.mockImplementation(() => vi.fn());
});

describe("wirePetControls", () => {
  function makeDeps() {
    const stores: SettingsStores = createSettingsStores();
    const registered: Array<() => void> = [];
    const stage = document.createElement("div");
    const removeEventListener = vi.spyOn(stage, "removeEventListener");
    const deps = {
      root: document.createElement("div"),
      stage,
      stores,
      config: {
        get: () => {
          throw new Error("config not loaded");
        },
      },
      renderer: { setMouthOpen: vi.fn(), stopMouth: vi.fn() },
      vrm: { vrmSelection: {}, swapVrm: vi.fn(), importVrm: vi.fn() },
      speaker: {
        speakerSelection: {},
        swapSpeaker: vi.fn(),
        refreshSpeaker: vi.fn(),
        pickVoiceImport: vi.fn(),
        commitVoiceImport: vi.fn(),
        removeVoice: vi.fn(),
        refreshVoiceList: vi.fn(),
      },
      pushSocket: {
        getState: vi.fn(),
        onState: vi.fn(() => () => {}),
        sendReset: vi.fn(),
        reconnectNow: vi.fn(),
      },
      stopTurn: vi.fn(),
      voiceInputStatus: createVoiceInputStatus(),
      screenSourceProvider: { listMonitors: vi.fn(async () => []) },
      surfaces: { isInputOpen: vi.fn(() => false), summonInput: vi.fn() },
      remoteSurfaces: { onOpenSettings: vi.fn() },
      openSettings: vi.fn(),
      openDevtools: vi.fn(),
      register: (teardown: () => void) => {
        registered.push(teardown);
      },
    };
    const controls = wirePetControls(deps as never);
    return { controls, deps, stores, registered, stage, removeEventListener };
  }

  function teardownDeps(wired: ReturnType<typeof makeDeps>) {
    for (const fn of wired.registered) fn();
    for (const store of Object.values(wired.stores)) store.dispose();
  }

  it("registers the six teardowns in the baseline boot order", () => {
    const wired = makeDeps();

    expect(wired.registered).toHaveLength(6);
    // The three indicator bindings drain disposed-then-rebuilt instances live, so their slots
    // identify them by behavior, not identity: draining 1-3 disposes quick, capture, voice.
    wired.registered[0]!();
    wired.registered[1]!();
    wired.registered[2]!();
    expect(events.filter((e) => e.endsWith(".dispose"))).toEqual([
      "quick.dispose",
      "capture.dispose",
      "voice.dispose",
    ]);
    // Slot 4 is the cue-locale sync disposer, slot 5 the locale unsubscriber, slot 6 the
    // context-menu remover.
    expect(wired.registered[3]).toBe(wireCueLocaleSync.mock.results[0]?.value);
    expect(localeSubscribers).toHaveLength(1);
    wired.registered[4]!();
    expect(localeSubscribers).toHaveLength(0);
    wired.registered[5]!();
    expect(wired.removeEventListener).toHaveBeenCalledWith("contextmenu", expect.any(Function));

    teardownDeps(wired);
  });

  it("defers the locale remount by exactly one microtask", async () => {
    const wired = makeDeps();
    expect(events).toEqual(["quick.build", "capture.build", "voice.build"]);

    localeSubscribers[0]!();
    expect(events).toEqual(["quick.build", "capture.build", "voice.build"]);

    await Promise.resolve();
    expect(events).toEqual([
      "quick.build",
      "capture.build",
      "voice.build",
      "voice.dispose",
      "capture.dispose",
      "quick.dispose",
      "quick.build",
      "capture.build",
      "voice.build",
    ]);
    await Promise.resolve();
    expect(events).toHaveLength(9);

    teardownDeps(wired);
  });

  it("get() returns the rebuilt panel after a locale remount", async () => {
    const wired = makeDeps();
    const first = wired.controls.get();
    localeSubscribers[0]!();
    await Promise.resolve();

    expect(wired.controls.get()).not.toBe(first);
    expect(wired.controls.get()).toBe(createQuickControls.mock.results.at(-1)?.value);
    wired.stage.dispatchEvent(
      new MouseEvent("contextmenu", { clientX: 5, clientY: 6, cancelable: true }),
    );
    expect(first.open).not.toHaveBeenCalled();
    expect(wired.controls.get().open).toHaveBeenCalledWith({ x: 5, y: 6 });

    teardownDeps(wired);
  });

  it("opens the live panel at the pointer from the stage context menu", () => {
    const wired = makeDeps();

    const event = new MouseEvent("contextmenu", { clientX: 12, clientY: 34, cancelable: true });
    wired.stage.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(wired.controls.get().open).toHaveBeenCalledWith({ x: 12, y: 34 });

    teardownDeps(wired);
  });

  it("guarded config readers fall back before the config loads", () => {
    const wired = makeDeps();
    const options = createQuickControls.mock.calls[0]?.[0] as Record<string, () => unknown>;

    expect(options.getRateLimitDefaults()).toBeUndefined();
    expect(options.getScreenDefaults()).toBeUndefined();
    expect(options.getDefaultInstructions()).toBeUndefined();
    expect(options.getEndpointDefaults()).toBeUndefined();
    expect(options.getDefaultChatApi()).toBeUndefined();
    expect(options.getIdlePool()).toBeUndefined();
    expect(options.getExpressMotions()).toEqual([]);

    teardownDeps(wired);
  });
});
