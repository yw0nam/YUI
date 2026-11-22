/** The Character menu's ports over the pet window's stores: what each pill reads and what its pick writes. */

import type { ConfigStore } from "../../config/store";
import type { ThreadsTab } from "../../io/bridge/settings-bridge";
import { resetConversation } from "../../io/chat/conversation/reset-conversation";
import type { PushSocket } from "../../io/chat/push/push-socket";
import type { ThreadsClient } from "../../io/threads/threads-client";
import { isUnseenWaiting } from "../../io/threads/threads-waiting";
import type { ThreadsWindowController } from "../../io/window/openers/threads-window";
import { createLogger } from "../../logger";
import { effectiveChatApi } from "../../settings/backend/endpoints-settings";
import type { SettingsPage } from "../../settings/panels/settings-pages";
import type { PetWindows } from "../../settings/preset/pet-windows";
import type { SettingsStores } from "../../settings/settings-stores";
import type { MenuActions } from "../../ui/character-menu/character-menu";
import type { MenuState } from "../../ui/character-menu/items";
import type { VoiceInputStatus } from "../../ui/chips/voice-input-status";
import type { Surfaces } from "../../ui/surfaces/surfaces";
import { quickControlsConfigDefaults } from "../settings/config-defaults";
import type { ConversationStores } from "../settings/conversation-stores";
import type { wireSpeakerSelection, wireVrmSelection } from "../settings/wire-avatar";

const log = createLogger("character-menu-ports");

/** What the menu reaches outside the pet window's stores, handed over by the window's entry. */
export interface CharacterMenuHost {
  boundId: string | null;
  /** Her name, shown above her head while the menu is open. */
  name: () => string;
  petWindows: Pick<PetWindows, "close">;
  /** Main's Threads window; null in a bound pet window, which asks main for it. */
  threadsWindow: Pick<ThreadsWindowController, "open"> | null;
  emitThreadsOpenRequest: (tab: ThreadsTab) => void;
  announceSessionReset: () => void;
}

interface Selection<T> {
  list(): T[];
  getActiveId(): string;
}

const options = <T extends { id: string; label?: string }>(selection: Selection<T>) =>
  selection.list().map((o) => ({ id: o.id, label: o.label ?? o.id }));

function select<T extends { id: string }>(
  selection: Selection<T>,
  swap: (option: T) => Promise<void>,
  id: string,
): void {
  const option = selection.list().find((o) => o.id === id);
  if (option) void swap(option).catch((err) => log.warn("select_failed", { error: String(err) }));
}

function flip(store: { setEnabled(on: boolean): void }, logKey: string, on: boolean): void {
  store.setEnabled(on);
  log.info(logKey, { enabled: on });
}

export function createCharacterMenuPorts(deps: {
  host: CharacterMenuHost;
  stores: Pick<
    SettingsStores,
    | "dndSettings"
    | "basePaceSettings"
    | "bubblePersistSettings"
    | "unifiedChatSwitch"
    | "endpointsSettings"
  >;
  surfaces: Pick<Surfaces, "isInputOpen" | "summonInput" | "dismissInput">;
  voiceInputStatus: Pick<VoiceInputStatus, "get" | "set">;
  openSettings: (page?: SettingsPage) => void;
  vrm: Pick<ReturnType<typeof wireVrmSelection>, "vrmSelection" | "swapVrm">;
  speaker: Pick<ReturnType<typeof wireSpeakerSelection>, "speakerSelection" | "swapSpeaker">;
  conversation: Pick<
    ConversationStores,
    "sessionStore" | "sessionDiagnostics" | "chatHistoryStore"
  >;
  config: Pick<ConfigStore, "get">;
  pushSocket?: Pick<PushSocket, "sendReset">;
  threads: Pick<ThreadsClient, "threads"> | null;
  stopTurn: () => void;
}): { read(): MenuState; actions: MenuActions } {
  const { host, stores, surfaces, vrm, speaker } = deps;
  const { getDefaultChatApi } = quickControlsConfigDefaults(deps.config);
  const isPush = () =>
    effectiveChatApi(stores.endpointsSettings.get().chat_api, getDefaultChatApi()) === "push";
  return {
    read: () => ({
      talk: surfaces.isInputOpen(),
      rest: stores.dndSettings.get().enabled,
      listen: deps.voiceInputStatus.get().state !== "idle",
      bubble: stores.bubblePersistSettings.get().enabled,
      unified: stores.unifiedChatSwitch.get().enabled,
      bodies: options(vrm.vrmSelection),
      body: vrm.vrmSelection.getActiveId(),
      voices: options(speaker.speakerSelection),
      voice: speaker.speakerSelection.getActiveId(),
      pace: stores.basePaceSettings.get().pace,
      waiting: deps.threads?.threads().filter(isUnseenWaiting).length ?? 0,
    }),
    actions: {
      talk: (open) => (open ? surfaces.summonInput() : surfaces.dismissInput()),
      rest: (on) => {
        stores.dndSettings.setEnabled(on);
        log.info("dnd_toggle", { enabled: on, via: "character_menu" });
      },
      listen: (on) => deps.voiceInputStatus.set(on ? "listening" : "idle"),
      settings: (page) => deps.openSettings(page),
      body: (id) => select(vrm.vrmSelection, vrm.swapVrm, id),
      voice: (id) => select(speaker.speakerSelection, speaker.swapSpeaker, id),
      pace: (pace) => stores.basePaceSettings.setPace(pace),
      // A bridge drops its own emits, so main opens its Threads window itself.
      threads: (tab) => {
        if (host.threadsWindow) host.threadsWindow.open(undefined, tab);
        else host.emitThreadsOpenRequest(tab);
      },
      bubble: (on) => flip(stores.bubblePersistSettings, "bubble_persist_toggle", on),
      unified: (on) => flip(stores.unifiedChatSwitch, "unified_chat_toggle", on),
      reset: () =>
        resetConversation({
          transcript: deps.conversation.chatHistoryStore,
          sessionStore: deps.conversation.sessionStore,
          sessionDiagnostics: deps.conversation.sessionDiagnostics,
          stopTurn: deps.stopTurn,
          announceSessionReset: host.announceSessionReset,
          push: isPush() ? deps.pushSocket : undefined,
          log,
        }),
      turnOff: () => {
        if (host.boundId !== null) host.petWindows.close(host.boundId);
      },
    },
  };
}
