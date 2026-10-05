/**
 * The phone's settings view wiring — the connection, character, history and general tabs over the
 * phone's stores, the full-screen view that shows them, and the Android back claim that closes the
 * view while it is open. The entry routes its openers here.
 */

import type { AvatarOption } from "../../../config/validators/avatar/types";
import type { EndpointsConfig } from "../../../contract";
import type { StageBackgroundStore } from "../../../io/assets/stage/stage-background";
import type { createVrmSelection } from "../../../io/assets/vrm-selection";
import type { PushSocket } from "../../../io/chat/push/push-socket";
import { createBackButtonClaim } from "../../../io/lifecycle/back-button";
import { createLogger } from "../../../logger";
import { endpointDefaultsOf } from "../../../settings/backend/endpoints-settings";
import type { SettingsStores } from "../../../settings/settings-stores";
import type { VoiceMode, VoiceModeStore } from "../../../settings/voice/voice-mode";
import { createGeneralTab } from "../../../ui/phone/settings/general/general-tab";
import {
  createPhoneSettingsView,
  type PhoneSettingsFocus,
  type PhoneSettingsTab,
} from "../../../ui/phone/settings/phone-settings-view";
import { createCharacterTab } from "../../../ui/quick-controls/character/character-tab";
import { createConnectionTab } from "../../../ui/quick-controls/connection/connection-tab";
import { createHistoryTab } from "../../../ui/quick-controls/history/history-tab";
import type { ConversationStores } from "../../settings/conversation-stores";

export interface PhoneSettings {
  /** Open the view on a tab, optionally focusing a field on it. */
  open(tab: PhoneSettingsTab, opts?: { focus?: PhoneSettingsFocus }): void;
  dispose(): void;
}

/** The phone's connection rows: push chat (URL/key/status), STT URL/model/key, TTS provider/URL/key. */
const CONNECTION_ROWS = { chat: "push", tts: "provider-url-key", broker: false } as const;

/** The phone's character rows: the VRM list and the view reset. */
const CHARACTER_ROWS = {
  vrms: true,
  gain: false,
  idleMotion: false,
  expressMotion: false,
  viewpoint: true,
} as const;

export function createPhoneSettings(deps: {
  /** The phone root the view overlays. */
  mount: HTMLElement;
  stores: SettingsStores;
  /** The VRM selection and its load, import and remove flows. */
  vrm: {
    vrmSelection: ReturnType<typeof createVrmSelection>;
    swapVrm: (option: AvatarOption) => Promise<void>;
    importVrm: () => Promise<void>;
  };
  removeUserVrm: (id: string) => Promise<void>;
  /** The stage backdrop's store and the flow that picks its image. */
  stageBackground: StageBackgroundStore;
  importStageImage: () => Promise<void>;
  /** The voice mode store and the port that applies a choice from the General tab. */
  voiceMode: VoiceModeStore;
  selectVoiceMode: (mode: VoiceMode) => void;
  conversation: Pick<
    ConversationStores,
    "sessionStore" | "sessionDiagnostics" | "chatHistoryStore"
  >;
  pushSocket: PushSocket;
  /** Stops the in-flight turn before "Start fresh" resets the conversation. */
  stopTurn: () => void;
  /** The phone's effective endpoints — push-only, so History's reset frames the backend. */
  getEndpoints: () => EndpointsConfig;
  /** The bundled config — its endpoints are the fields' placeholders once it has loaded. */
  config: { get(): { endpoints: EndpointsConfig } };
}): PhoneSettings {
  const {
    mount,
    stores,
    vrm,
    removeUserVrm,
    stageBackground,
    importStageImage,
    voiceMode,
    selectVoiceMode,
    conversation,
    pushSocket,
    stopTurn,
    getEndpoints,
    config,
  } = deps;
  const log = createLogger("phone-settings");

  const connection = createConnectionTab({
    endpointsSettings: stores.endpointsSettings,
    chatKeySettings: stores.chatKeySettings,
    sttKeySettings: stores.sttKeySettings,
    ttsKeySettings: stores.ttsKeySettings,
    getEndpointDefaults: () => endpointDefaultsOf(config),
    rows: CONNECTION_ROWS,
    pushSocket,
    isOpen: () => view.isOpen(),
    log,
  });

  const character = createCharacterTab({
    rows: CHARACTER_ROWS,
    variant: "phone",
    ...vrm,
    removeUserVrm,
    onResetView: stores.cameraSettings.resetView,
    isOpen: () => view.isOpen(),
    log,
  });

  const history = createHistoryTab({
    transcript: conversation.chatHistoryStore,
    sessionDiagnostics: conversation.sessionDiagnostics,
    sessionStore: conversation.sessionStore,
    stopTurn,
    pushSocket,
    getChatApi: () => getEndpoints().chat_api,
    isOpen: () => view.isOpen(),
    log,
  });

  const general = createGeneralTab({
    stageBackground,
    importStageImage,
    bubblePersistSettings: stores.bubblePersistSettings,
    voiceMode,
    selectVoiceMode,
    log,
  });

  // The system back gesture closes the view while it is open and keeps its default otherwise.
  const back = createBackButtonClaim();
  const view = createPhoneSettingsView({
    mount,
    connection,
    character,
    history,
    general,
    onClose: () => back.release(),
  });

  return {
    open(tab, opts) {
      back.claim(view.close);
      view.open(tab, opts);
    },
    dispose(): void {
      view.dispose();
      // The connection tab commits typed input before it lets go of its subscriptions.
      connection.dispose();
      character.dispose();
      history.dispose();
      general.dispose();
      back.dispose();
    },
  };
}
