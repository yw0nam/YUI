// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

const { createQuickCardWindowController, wireCueLocaleSync } = vi.hoisted(() => ({
  createQuickCardWindowController:
    vi.fn<
      typeof import("../../io/window/openers/quick-card-window").createQuickCardWindowController
    >(),
  wireCueLocaleSync: vi.fn<() => () => void>(() => () => {}),
}));

vi.mock("../../io/window/openers/quick-card-window", () => ({ createQuickCardWindowController }));
vi.mock("../settings/wire-cue-locale-sync", () => ({ wireCueLocaleSync }));

import { createSettingsStores, type SettingsStores } from "../../settings/settings-stores";
import { createVoiceInputStatus, type VoiceInputStatus } from "../../ui/chips/voice-input-status";
import { wirePetControls } from "./wire-pet-controls";

describe("wirePetControls", () => {
  function makeDeps(boundId: string | null = null, over: Record<string, unknown> = {}) {
    const stores: SettingsStores = createSettingsStores();
    const registered: Array<() => void> = [];
    const stage = document.createElement("div");
    const removeEventListener = vi.spyOn(stage, "removeEventListener");
    const controller = {
      open: vi.fn(),
      dispose: vi.fn(),
    };
    createQuickCardWindowController.mockReturnValue(controller);
    const deps = {
      boundId,
      stage,
      stores,
      renderer: {
        getCharacterAnchor: vi.fn(() => ({ x: 200, y: 300 })),
        getCharacterWidthPx: vi.fn(() => 100),
      },
      voiceInputStatus: createVoiceInputStatus() as VoiceInputStatus,
      remoteSurfaces: { onOpenSettings: vi.fn() },
      openSettings: vi.fn(),
      bridge: { emitQuickCardOpen: vi.fn(), onQuickCardReady: vi.fn(() => () => {}) },
      register: (teardown: () => void) => {
        registered.push(teardown);
      },
      ...over,
    };
    const controls = wirePetControls(deps as never);
    return { controls, deps, stores, registered, stage, removeEventListener, controller };
  }

  function teardownDeps(wired: ReturnType<typeof makeDeps>) {
    for (const fn of wired.registered) fn();
    for (const store of Object.values(wired.stores)) store.dispose();
  }

  it("sends the character's extent and the click to the quick-card window from the stage context menu", () => {
    const wired = makeDeps();

    const event = new MouseEvent("contextmenu", { clientX: 12, clientY: 34, cancelable: true });
    wired.stage.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    // Her anchor x 200 with width 100 spans 150..250; the click's y rides along.
    expect(wired.controller.open).toHaveBeenCalledExactlyOnceWith({
      left: 150,
      right: 250,
      y: 34,
      listening: false,
    });
    expect(wired.controls).toBe(wired.controller);

    teardownDeps(wired);
  });

  it("names no listening flag on another character's card", () => {
    const wired = makeDeps("a");

    wired.stage.dispatchEvent(
      new MouseEvent("contextmenu", { clientX: 12, clientY: 34, cancelable: true }),
    );

    expect(wired.controller.open).toHaveBeenCalledExactlyOnceWith({
      left: 150,
      right: 250,
      y: 34,
    });

    teardownDeps(wired);
  });

  it("falls back to the click's x for both edges when the renderer has no anchor", () => {
    const wired = makeDeps(null, {
      renderer: {
        getCharacterAnchor: vi.fn(() => null),
        getCharacterWidthPx: vi.fn(() => 100),
      },
    });

    wired.stage.dispatchEvent(
      new MouseEvent("contextmenu", { clientX: 12, clientY: 34, cancelable: true }),
    );

    expect(wired.controller.open).toHaveBeenCalledExactlyOnceWith({
      left: 12,
      right: 12,
      y: 34,
      listening: false,
    });

    teardownDeps(wired);
  });

  it("reports main's live voice input as the listening flag", () => {
    const wired = makeDeps();
    wired.deps.voiceInputStatus.set("listening");

    wired.stage.dispatchEvent(
      new MouseEvent("contextmenu", { clientX: 12, clientY: 34, cancelable: true }),
    );

    expect(wired.controller.open).toHaveBeenCalledExactlyOnceWith({
      left: 150,
      right: 250,
      y: 34,
      listening: true,
    });

    teardownDeps(wired);
  });

  it("opens the settings window on Connection when a popped-out surface asks for settings", () => {
    const wired = makeDeps();
    try {
      const ask = wired.deps.remoteSurfaces.onOpenSettings.mock.calls[0]![0];

      ask();

      expect(wired.deps.openSettings).toHaveBeenCalledExactlyOnceWith("conn");
    } finally {
      teardownDeps(wired);
    }
  });

  it("registers the three teardowns in the baseline boot order", () => {
    const wired = makeDeps();

    expect(wired.registered).toHaveLength(3);
    // Slot 1 disposes the controller, slot 2 is the cue-locale sync disposer, slot 3 the context-menu remover.
    wired.registered[0]!();
    expect(wired.controller.dispose).toHaveBeenCalledOnce();
    expect(wired.registered[1]).toBe(wireCueLocaleSync.mock.results[0]?.value);
    wired.registered[2]!();
    expect(wired.removeEventListener).toHaveBeenCalledWith("contextmenu", expect.any(Function));

    teardownDeps(wired);
  });
});
