import type { PushSocketState } from "../../../../io/chat/push/push-socket";
import { t } from "../../../i18n";

/** Where the push socket stands, in words: the status line's text and the quick card's head. */
export function pushStateText(state: PushSocketState): string {
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
