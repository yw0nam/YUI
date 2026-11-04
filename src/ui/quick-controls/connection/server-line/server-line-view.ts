/** Maps one server check to the status line's view — pure, no DOM. */

import type { ServerCheck } from "../../../../io/chat/models/server-check";
import { t } from "../../../i18n";
import type { StatusView } from "../chat/model-status";

export function serverLineView(result: ServerCheck | "checking", host: string): StatusView {
  if (result === "checking") {
    return { text: t("svc.chat_status_connecting"), dot: ["is-waiting", "is-busy"] };
  }
  switch (result.kind) {
    case "ok":
      return { text: t("svc.server_connected", { host }), dot: ["is-ready"] };
    case "unreachable":
      return {
        text: t("svc.chat_models_unreachable", { host }),
        dot: ["is-failed"],
        action: t("svc.chat_status_reconnect"),
      };
    case "timeout":
      return {
        text: t("svc.chat_models_timeout", { host }),
        dot: ["is-failed"],
        action: t("svc.chat_status_reconnect"),
      };
    case "refused":
      return { text: t("svc.chat_models_refused"), dot: ["is-failed"] };
    case "http":
      return { text: t("svc.chat_models_http", { status: result.status }), dot: ["is-failed"] };
    case "malformed":
      // checkServer folds a listing-less answer into ok — the server answered.
      return { text: t("svc.server_connected", { host }), dot: ["is-ready"] };
  }
}
