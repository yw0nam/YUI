/** The quick card's head line: the chat transport's name, and on push where its socket stands. */

import type { PushSocketState } from "../../io/chat/push/push-socket";
import type { ChatTransport } from "../../settings/backend/endpoints-settings";
import { t } from "../i18n";

function pushStateText(state: PushSocketState): string {
  switch (state.kind) {
    case "ready":
      return t("svc.chat_status_connected", { id: state.chat_id });
    case "connecting":
      return t("svc.chat_status_connecting");
    case "reconnecting":
      return t("svc.chat_status_reconnecting", { seconds: Math.ceil(state.delay_ms / 1000) });
    case "failed":
      return t("svc.chat_status_refused");
    case "disconnected":
      return t("svc.chat_status_offline");
  }
}

export function transportLine(transport: { api: ChatTransport; push?: PushSocketState }): string {
  const name = t(`svc.chat_name_${transport.api}`);
  return transport.push ? `${name} · ${pushStateText(transport.push)}` : name;
}
