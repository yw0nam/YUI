/**
 * The phone's settings/history view wiring — the connection and history tabs over the phone's
 * stores, the full-screen view that shows them, and the Android back claim that closes the view
 * while it is open. The entry routes its openers here.
 */

import type { EndpointsConfig } from "../../../contract";
import type { PushSocket } from "../../../io/chat/push-socket";
import { createBackButtonClaim } from "../../../io/lifecycle/back-button";
import { createLogger } from "../../../logger";
import { endpointDefaultsOf } from "../../../settings/backend/endpoints-settings";
import type { SettingsStores } from "../../../settings/settings-stores";
import {
  createPhoneSettingsView,
  type PhoneSettingsTab,
} from "../../../ui/phone/settings/phone-settings-view";
import { createConnectionTab } from "../../../ui/quick-controls/connection/connection-tab";
import { createHistoryTab } from "../../../ui/quick-controls/history/history-tab";
import type { ConversationStores } from "../../settings/conversation-stores";

export interface PhoneSettings {
  /** Open the view on a tab (Connection or History). */
  open(tab: PhoneSettingsTab): void;
  close(): void;
  isOpen(): boolean;
  dispose(): void;
}

/** The phone's tab rows: push chat (URL/key/status), STT URL/model/key, TTS URL/key. */
const PHONE_ROWS = { chat: "push", tts: "url-key", broker: false } as const;

export function createPhoneSettings(deps: {
  /** The phone root the view overlays. */
  mount: HTMLElement;
  stores: SettingsStores;
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
  const { mount, stores, conversation, pushSocket, stopTurn, getEndpoints, config } = deps;
  const log = createLogger("phone-settings");

  const connection = createConnectionTab({
    endpointsSettings: stores.endpointsSettings,
    chatKeySettings: stores.chatKeySettings,
    sttKeySettings: stores.sttKeySettings,
    ttsKeySettings: stores.ttsKeySettings,
    getEndpointDefaults: () => endpointDefaultsOf(config),
    rows: PHONE_ROWS,
    pushSocket,
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

  // The system back gesture closes the view while it is open and keeps its default otherwise.
  const back = createBackButtonClaim();
  const view = createPhoneSettingsView({
    mount,
    connection,
    history,
    onClose: () => back.release(),
  });

  return {
    open(tab) {
      back.claim(view.close);
      view.open(tab);
    },
    close: view.close,
    isOpen: view.isOpen,
    dispose(): void {
      view.dispose();
      // The connection tab commits typed input before it lets go of its subscriptions.
      connection.dispose();
      history.dispose();
      back.dispose();
    },
  };
}
