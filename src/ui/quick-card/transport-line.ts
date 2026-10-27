/** The quick card's head line: the chat transport's name, and on push where its socket stands. */

import type { PushSocketState } from "../../io/chat/push/push-socket";
import type { ChatTransport } from "../../settings/backend/endpoints-settings";
import { t } from "../i18n";
import { pushStateText } from "../quick-controls/connection/chat/push-state-text";

export function transportLine(transport: { api: ChatTransport; push?: PushSocketState }): string {
  const name = t(`svc.chat_name_${transport.api}`);
  return transport.push ? `${name} · ${pushStateText(transport.push)}` : name;
}
