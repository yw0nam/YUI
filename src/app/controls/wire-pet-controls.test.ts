// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createQuickCard, wireCueLocaleSync, localeSubscribers } = vi.hoisted(() => ({
  createQuickCard: vi.fn<typeof import("../../ui/quick-card/quick-card").createQuickCard>(),
  wireCueLocaleSync: vi.fn(),
  localeSubscribers: [] as Array<() => void>,
}));

vi.mock("../../ui/quick-card/quick-card", () => ({ createQuickCard }));
vi.mock("../settings/wire-cue-locale-sync", () => ({ wireCueLocaleSync }));
vi.mock("../../ui/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ui/i18n")>()),
  subscribe: (cb: () => void) => {
    localeSubscribers.push(cb);
    return () => {
      localeSubscribers.splice(localeSubscribers.indexOf(cb), 1);
    };
  },
}));

import { createSettingsStores, type SettingsStores } from "../../settings/settings-stores";
import { createVoiceInputStatus } from "../../ui/chips/voice-input-status";
import { createConversationStores } from "../settings/conversation-stores";
import { wirePetControls } from "./wire-pet-controls";

/** The build/dispose event trail of the mocked card factory. */
const events: string[] = [];

beforeEach(() => {
  events.length = 0;
  createQuickCard.mockImplementation(() => {
    events.push("card.build");
    return {
      el: document.createElement("div"),
      open: vi.fn(),
      close: vi.fn(),
      isOpen: vi.fn(() => false),
      dispose: vi.fn(() => void events.push("card.dispose")),
    };
  });
  wireCueLocaleSync.mockImplementation(() => vi.fn());
});

/** The card the wiring built at `index` (negative counts from the last), with its options. */
function built(index: number) {
  expect(createQuickCard).toHaveBeenCalled();
  return {
    options: createQuickCard.mock.calls.at(index)![0],
    card: createQuickCard.mock.results.at(index)!.value,
  };
}

describe("wirePetControls", () => {
  function makeDeps(boundId: string | null = null) {
    const stores: SettingsStores = createSettingsStores();
    const conversation = createConversationStores();
    const registered: Array<() => void> = [];
    const stage = document.createElement("div");
    const removeEventListener = vi.spyOn(stage, "removeEventListener");
    const deps = {
      boundId,
      root: document.createElement("div"),
      stage,
      stores,
      conversation,
      config: {
        get: () => {
          throw new Error("config not loaded");
        },
      },
      vrm: {
        vrmSelection: { list: () => [], getActiveId: () => "", subscribe: () => () => {} },
        swapVrm: vi.fn(),
      },
      speaker: {
        speakerSelection: { list: () => [], getActiveId: () => "", subscribe: () => () => {} },
        swapSpeaker: vi.fn(),
        canManageVoices: () => false,
        canReuploadVoices: () => false,
        canPasteVoiceId: () => false,
      },
      pushSocket: {
        getState: vi.fn(() => ({ kind: "connecting" as const })),
        onState: vi.fn(() => () => {}),
        sendReset: vi.fn(() => true),
      },
      stopTurn: vi.fn(),
      announceSessionReset: vi.fn(),
      presetRegistry: {
        get: () => ({ active: "default", list: [] }),
        subscribe: () => () => {},
      },
      petWindows: { close: vi.fn(), get: () => [], subscribe: () => () => {} },
      voiceInputStatus: createVoiceInputStatus(),
      remoteSurfaces: { onOpenSettings: vi.fn() },
      openSettings: vi.fn(),
      register: (teardown: () => void) => {
        registered.push(teardown);
      },
    };
    const controls = wirePetControls(deps as never);
    const options = () => built(-1).options;
    return { controls, deps, stores, registered, stage, removeEventListener, options };
  }

  function teardownDeps(wired: ReturnType<typeof makeDeps>) {
    for (const fn of wired.registered) fn();
    for (const store of Object.values(wired.stores)) store.dispose();
    for (const store of Object.values(wired.deps.conversation)) store.dispose();
  }

  it.each([
    null,
    "a",
  ])("gives main the Listen tile and a bound card its Turn off, across a remount (bound: %s)", async (boundId) => {
    const wired = makeDeps(boundId);
    try {
      for (const remount of [false, true]) {
        if (remount) {
          localeSubscribers[0]!();
          await Promise.resolve();
        }
        const options = wired.options();
        expect(options.listen === null).toBe(boundId !== null);
        expect(options.turnOff === null).toBe(boundId === null);
      }
      wired.options().turnOff?.();
      expect(wired.deps.petWindows.close.mock.calls).toEqual(boundId ? [[boundId]] : []);
      wired.options().openAllSettings();
      expect(wired.deps.openSettings).toHaveBeenCalledExactlyOnceWith();
    } finally {
      teardownDeps(wired);
    }
  });

  it("listens through the voice input status", () => {
    const wired = makeDeps();
    try {
      const listen = wired.options().listen!;
      listen.set(true);
      expect(wired.deps.voiceInputStatus.get().state).toBe("listening");
      expect(listen.get()).toBe(true);
      listen.set(false);
      expect(wired.deps.voiceInputStatus.get().state).toBe("idle");
    } finally {
      teardownDeps(wired);
    }
  });

  it("heads the card with the transport in effect and, on push, the socket's state", () => {
    const wired = makeDeps();
    try {
      const options = wired.options();
      const repaint = vi.fn();
      options.onTransport(repaint);
      expect(options.transport()).toEqual({ api: "responses" });

      wired.stores.endpointsSettings.set({ chat_api: "push" });

      expect(repaint).toHaveBeenCalled();
      expect(options.transport()).toEqual({ api: "push", push: { kind: "connecting" } });
    } finally {
      teardownDeps(wired);
    }
  });

  it("resets the conversation the way History's start fresh does, with the frame on push", () => {
    const wired = makeDeps();
    try {
      wired.stores.endpointsSettings.set({ chat_api: "push" });
      wired.deps.conversation.chatHistoryStore.append({ role: "user", text: "hi", ts: 1 });

      const calls: string[] = [];
      wired.deps.stopTurn.mockImplementation(() => void calls.push("stopTurn"));
      wired.deps.pushSocket.sendReset.mockImplementation(() => {
        calls.push("sendReset");
        return true;
      });

      wired.options().resetConversation();

      // A turn still running stops before the reset frame goes out.
      expect(calls).toEqual(["stopTurn", "sendReset"]);
      expect(wired.deps.announceSessionReset).toHaveBeenCalledOnce();
      expect(wired.deps.conversation.chatHistoryStore.sessions()).toHaveLength(2);
    } finally {
      teardownDeps(wired);
    }
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

  it("registers the four teardowns in the baseline boot order", () => {
    const wired = makeDeps();

    expect(wired.registered).toHaveLength(4);
    // The card binding drains a disposed-then-rebuilt instance live, so its slot is identified
    // by behavior, not identity.
    wired.registered[0]!();
    expect(events.filter((e) => e.endsWith(".dispose"))).toEqual(["card.dispose"]);
    // Slot 2 is the cue-locale sync disposer, slot 3 the locale unsubscriber, slot 4 the
    // context-menu remover.
    expect(wired.registered[1]).toBe(wireCueLocaleSync.mock.results[0]?.value);
    expect(localeSubscribers).toHaveLength(1);
    wired.registered[2]!();
    expect(localeSubscribers).toHaveLength(0);
    wired.registered[3]!();
    expect(wired.removeEventListener).toHaveBeenCalledWith("contextmenu", expect.any(Function));

    teardownDeps(wired);
  });

  it("defers the locale remount by exactly one microtask", async () => {
    const wired = makeDeps();
    expect(events).toEqual(["card.build"]);

    localeSubscribers[0]!();
    expect(events).toEqual(["card.build"]);

    await Promise.resolve();
    expect(events).toEqual(["card.build", "card.dispose", "card.build"]);
    await Promise.resolve();
    expect(events).toHaveLength(3);

    teardownDeps(wired);
  });

  it("get() drives the rebuilt card after a locale remount", async () => {
    const wired = makeDeps();
    const first = built(0).card;
    localeSubscribers[0]!();
    await Promise.resolve();
    const rebuilt = built(-1).card;

    wired.controls.get().open({ x: 1, y: 2 });
    wired.stage.dispatchEvent(
      new MouseEvent("contextmenu", { clientX: 5, clientY: 6, cancelable: true }),
    );

    expect(first.open).not.toHaveBeenCalled();
    expect(rebuilt.open.mock.calls).toEqual([[{ x: 1, y: 2 }], [{ x: 5, y: 6 }]]);
    expect(wired.controls.get().el).toBe(rebuilt.el);

    teardownDeps(wired);
  });

  it("opens the live card at the pointer from the stage context menu", () => {
    const wired = makeDeps();

    const event = new MouseEvent("contextmenu", { clientX: 12, clientY: 34, cancelable: true });
    wired.stage.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(built(0).card.open).toHaveBeenCalledWith({ x: 12, y: 34 });

    teardownDeps(wired);
  });

  it("tells each open listener when the card opens, across a remount", async () => {
    const wired = makeDeps();
    const onOpen = vi.fn();
    wired.controls.onOpen(onOpen);
    wired.options().onOpen?.();
    localeSubscribers[0]!();
    await Promise.resolve();
    wired.options().onOpen?.();

    expect(onOpen).toHaveBeenCalledTimes(2);

    teardownDeps(wired);
  });
});
