// @vitest-environment jsdom
/**
 * quick-card-ports.test.ts — what the quick card's tiles, header and actions read and write
 * over the quick-card window's stores.
 */

import { afterEach, expect, it, vi } from "vitest";
import { createSettingsStores } from "../../settings/settings-stores";
import { createVoiceInputStatus } from "../../ui/chips/voice-input-status";
import { createConversationStores } from "../settings/conversation-stores";
import { createQuickCardPorts } from "./quick-card-ports";

const disposers: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function ports(boundId: string | null = null) {
  const stores = createSettingsStores();
  const conversation = createConversationStores();
  for (const store of [...Object.values(stores), ...Object.values(conversation)])
    disposers.push(() => store.dispose());
  const selection = { list: () => [], getActiveId: () => "", subscribe: () => () => {} };
  const deps = {
    stores,
    conversation,
    config: {
      get: (): never => {
        throw new Error("config not loaded");
      },
    },
    vrm: { vrmSelection: selection, swapVrm: vi.fn(async () => {}) },
    speaker: { speakerSelection: selection, swapSpeaker: vi.fn(async () => {}) },
    pushSocket: {
      getState: vi.fn(() => ({ kind: "connecting" as const })),
      onState: vi.fn(() => () => {}),
      sendReset: vi.fn(() => true),
    },
    announceSessionReset: vi.fn(),
    presetRegistry: { get: () => ({ active: "default", list: [] }), subscribe: () => () => {} },
    petWindows: { close: vi.fn() },
    boundId,
    voiceInputStatus: createVoiceInputStatus(),
    openSettings: vi.fn(),
  };
  return { deps, ports: createQuickCardPorts(deps as never) };
}

it.each([
  [null, true, []],
  ["a", false, [["a"]]],
])("gives main the Listen tile and a bound card its Turn off (bound: %s)", (boundId, hasListen, closed) => {
  const { deps, ports: p } = ports(boundId);

  p.turnOff?.();
  p.openAllSettings();

  expect(p.listen !== null).toBe(hasListen);
  expect(p.turnOff !== null).toBe(!hasListen);
  expect(deps.petWindows.close.mock.calls).toEqual(closed);
  expect(deps.openSettings).toHaveBeenCalledExactlyOnceWith();
});

it("listens through the voice input status", () => {
  const { deps, ports: p } = ports();

  p.listen!.set(true);
  expect(deps.voiceInputStatus.get().state).toBe("listening");
  expect(p.listen!.get()).toBe(true);
  p.listen!.set(false);
  expect(deps.voiceInputStatus.get().state).toBe("idle");
});

it("heads the card with the transport in effect and, on push, the socket's state", () => {
  const { deps, ports: p } = ports();
  const repaint = vi.fn();
  p.onTransport(repaint);
  expect(p.transport()).toEqual({ api: "responses" });

  deps.stores.endpointsSettings.set({ chat_api: "push" });

  expect(repaint).toHaveBeenCalled();
  expect(p.transport()).toEqual({ api: "push", push: { kind: "connecting" } });
});

it("resets the conversation the way History's start fresh does, with the frame on push", () => {
  const { deps, ports: p } = ports();
  deps.stores.endpointsSettings.set({ chat_api: "push" });
  deps.conversation.chatHistoryStore.append({ role: "user", text: "hi", ts: 1 });

  p.resetConversation();

  expect(deps.pushSocket.sendReset).toHaveBeenCalledOnce();
  expect(deps.announceSessionReset).toHaveBeenCalledOnce();
  expect(deps.conversation.chatHistoryStore.sessions()).toHaveLength(2);
});
