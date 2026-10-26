/** The quick card's ports over this pet window's stores: what each tile, select and action reads and writes. */

import type { ConfigStore } from "../../config/store";
import { resetConversation } from "../../io/chat/conversation/reset-conversation";
import type { PushSocket } from "../../io/chat/push/push-socket";
import { createLogger } from "../../logger";
import { effectiveChatApi } from "../../settings/backend/endpoints-settings";
import { presetEntryFor } from "../../settings/preset/active-preset";
import type { PetWindows } from "../../settings/preset/pet-windows";
import type { PresetRegistry } from "../../settings/preset/preset-registry";
import type { SettingsStores } from "../../settings/settings-stores";
import type { VoiceInputStatus } from "../../ui/chips/voice-input-status";
import type { createQuickCard, PickerPort } from "../../ui/quick-card/quick-card";
import { createSwitchRows } from "../../ui/quick-controls/switch-row";
import { quickControlsConfigDefaults } from "../settings/config-defaults";
import type { ConversationStores } from "../settings/conversation-stores";
import type { wireSpeakerSelection, wireVrmSelection } from "../settings/wire-avatar";

const log = createLogger("quick-card-ports");

type CardPorts = Omit<
  Parameters<typeof createQuickCard>[0],
  "mount" | "visibleViewport" | "onOpen"
>;

interface Selection<T> {
  list(): T[];
  getActiveId(): string;
  subscribe(cb: () => void): () => void;
}

function pickerOf<T extends { id: string; label?: string }>(
  selection: Selection<T>,
  swap: (option: T) => Promise<void>,
): PickerPort {
  return {
    options: () => selection.list().map((o) => ({ id: o.id, label: o.label ?? o.id })),
    current: () => selection.getActiveId(),
    select: async (id) => {
      const option = selection.list().find((o) => o.id === id);
      if (option) await swap(option);
    },
    subscribe: (cb) => selection.subscribe(() => cb()),
  };
}

export function createQuickCardPorts(deps: {
  stores: Pick<
    SettingsStores,
    | "endpointsSettings"
    | "ttsSettings"
    | "bubblePersistSettings"
    | "unifiedChatSwitch"
    | "idleThrottleSettings"
    | "vadSettings"
    | "fillerSettings"
  >;
  conversation: Pick<
    ConversationStores,
    "sessionStore" | "sessionDiagnostics" | "chatHistoryStore"
  >;
  config: Pick<ConfigStore, "get">;
  vrm: Pick<ReturnType<typeof wireVrmSelection>, "vrmSelection" | "swapVrm">;
  speaker: Pick<ReturnType<typeof wireSpeakerSelection>, "speakerSelection" | "swapSpeaker">;
  pushSocket: Pick<PushSocket, "getState" | "onState" | "sendReset">;
  stopTurn: () => void;
  announceSessionReset: () => void;
  presetRegistry: Pick<PresetRegistry, "get" | "subscribe">;
  petWindows: Pick<PetWindows, "close">;
  boundId: string | null;
  voiceInputStatus: VoiceInputStatus;
  openSettings: () => void;
}): CardPorts {
  const { stores, pushSocket, voiceInputStatus, boundId } = deps;
  const { getDefaultChatApi } = quickControlsConfigDefaults(deps.config);
  const api = () => effectiveChatApi(stores.endpointsSettings.get().chat_api, getDefaultChatApi());
  const rows = createSwitchRows({
    idleThrottleSettings: stores.idleThrottleSettings,
    vad: stores.vadSettings,
    fillerSettings: stores.fillerSettings,
    ttsSettings: stores.ttsSettings,
    bubblePersistSettings: stores.bubblePersistSettings,
    unifiedChatSwitch: stores.unifiedChatSwitch,
  });
  const row = (selector: string) => rows.find((r) => r.selector === selector)!;
  return {
    entry: () => presetEntryFor(deps.presetRegistry.get(), boundId),
    subscribeEntry: (cb) => deps.presetRegistry.subscribe(() => cb()),
    transport: () =>
      api() === "push" ? { api: "push", push: pushSocket.getState() } : { api: api() },
    onTransport: (cb) => {
      const offEndpoints = stores.endpointsSettings.subscribe(() => cb());
      const offState = pushSocket.onState(() => cb());
      return () => {
        offEndpoints();
        offState();
      };
    },
    tiles: {
      voice: row(".yui-tts-switch"),
      bubble: row(".yui-bubble-persist-switch"),
      unified: row(".yui-unified-switch"),
    },
    // Voice input runs in the main window only.
    listen:
      boundId === null
        ? {
            get: () => voiceInputStatus.get().state !== "idle",
            set: (on) => voiceInputStatus.set(on ? "listening" : "idle"),
            subscribe: (cb) => voiceInputStatus.subscribe(() => cb()),
          }
        : null,
    body: pickerOf(deps.vrm.vrmSelection, deps.vrm.swapVrm),
    voice: pickerOf(deps.speaker.speakerSelection, deps.speaker.swapSpeaker),
    resetConversation: () =>
      resetConversation({
        transcript: deps.conversation.chatHistoryStore,
        sessionStore: deps.conversation.sessionStore,
        sessionDiagnostics: deps.conversation.sessionDiagnostics,
        stopTurn: deps.stopTurn,
        announceSessionReset: deps.announceSessionReset,
        push: api() === "push" ? pushSocket : undefined,
        log,
      }),
    turnOff: boundId === null ? null : () => deps.petWindows.close(boundId),
    openAllSettings: () => deps.openSettings(),
  };
}
