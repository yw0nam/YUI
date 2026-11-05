/** Maps one server check to the status line's view — pure, no DOM. */

import type { ServerCheck } from "../../../../io/chat/models/server-check";
import { t } from "../../../i18n";
import type { StatusView } from "../chat/model-status";
import { failureView } from "../chat/model-status";

export function serverLineView(result: ServerCheck | "checking", host: string): StatusView {
  if (result === "checking") {
    return { text: t("svc.chat_status_connecting"), dot: ["is-waiting", "is-busy"] };
  }
  switch (result.kind) {
    case "ok":
      return { text: t("svc.server_connected", { host }), dot: ["is-ready"] };
    case "unreachable":
    case "timeout":
    case "refused":
    case "http":
      return failureView(result, host);
    case "malformed":
      // The check answered with a body it could not read — the server answered.
      return { text: t("svc.server_connected", { host }), dot: ["is-ready"] };
  }
}
