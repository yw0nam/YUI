/**
 * Backend-call failure reason → inline input-error message.
 *
 * Delegates to the i18n dictionary. Only the reasons a user-initiated turn can
 * actually fail with (see dispatcher.ts's onUserTurnFailed) map to a message;
 * anything else renders nothing rather than inventing text. A network_drop carrying
 * the server's {status, message} detail renders the status and the server text, and one without
 * a status renders the server text alone; a 429 renders the rate-limit line instead.
 */

import type { TurnErrorDetail, TurnFailure } from "../../dispatcher/backend/backend-caller";
import type { UserTurnSource } from "../../dispatcher/core/classify";
import type { InputErrorAction } from "../../io/bridge/message/message-remote";
import type { SettingsPage } from "../../settings/panels/settings-pages";
import { t } from "../i18n";

/** Rendered server-message budget — one line, cut with an ellipsis past this. */
const SERVER_MESSAGE_MAX_CHARS = 200;

/** Server error text → one line of at most 200 characters, ending with an ellipsis when cut. */
function collapseServerMessage(message: string): string {
  const oneLine = message.replace(/\s+/g, " ").trim();
  return oneLine.length > SERVER_MESSAGE_MAX_CHARS
    ? `${oneLine.slice(0, SERVER_MESSAGE_MAX_CHARS - 1)}…`
    : oneLine;
}

export function turnErrorMessage(
  reason: TurnFailure,
  detail?: TurnErrorDetail,
): string | undefined {
  switch (reason) {
    case "not_configured":
      return t("input.error_not_configured");
    case "http_4xx_drop":
      return t("input.error_auth");
    case "network_drop":
      if (detail?.status === 429) return t("input.error_rate_limit");
      if (detail) {
        // One application collapses the message's newlines AND keeps the whole rendered
        // line (status included) inside the 200-character budget.
        return collapseServerMessage(
          detail.status === undefined
            ? detail.message
            : t("input.error_http", { status: detail.status, message: detail.message }),
        );
      }
      return t("input.error_network");
    case "network_stall":
      return t("input.error_stall");
    case "parse_error":
      return t("input.error_parse");
    default:
      return undefined;
  }
}

export type FailureAction = "connect" | "change_key" | "check_connection" | "retry";

const ACTION_LABEL_KEY = {
  connect: "hint.setup_action",
  change_key: "input.action_change_key",
  check_connection: "input.action_check_connection",
  retry: "input.action_retry",
} as const;

/**
 * The next step a failed turn offers; every surface reads it. A rejected key or a not-yet-connected
 * backend opens the key entry, another 4xx opens it to check the connection, a drop or a stall
 * resends. Takes a raw string because the status pill reads its reason off an untyped status detail.
 */
export function failureAction(reason: string, detail?: TurnErrorDetail): FailureAction | undefined {
  switch (reason) {
    case "not_configured":
      return "connect";
    case "http_4xx_drop":
      return "change_key";
    case "network_drop": {
      const status = detail?.status;
      if (status === undefined || (status >= 500 && status < 600)) return "retry";
      return status >= 400 && status < 500 && status !== 429 ? "check_connection" : undefined;
    }
    case "network_stall":
      return "retry";
    default:
      return undefined;
  }
}

/** The button of a keyed action, which opens the key entry; retry is the composer's own, so it has none. */
export function fixAction(
  action: FailureAction | undefined,
  openSettings?: (tab: SettingsPage) => void,
): InputErrorAction | undefined {
  if (!openSettings || !action || action === "retry") return undefined;
  return {
    label: t(ACTION_LABEL_KEY[action]),
    onClick: () => openSettings("conn"), // focus: chat_key once the opener takes it
  };
}

type TurnFailureAction = { kind: "show_input_error" } | { kind: "voice_error" } | { kind: "none" };

/**
 * Routes a classified user-turn failure to the UI surface it belongs to. Routes by
 * `source` (which trigger actually failed), not by the input form's CURRENT open
 * state alone — a typed turn dismissed with Escape mid-flight must not get
 * misrouted to the status pill's voice error just because the form happens to be closed by
 * the time the failure arrives.
 *  - text + input open   -> the inline input error.
 *  - text + input closed -> nothing (the user already dismissed it; log-only).
 *  - voice                -> always the status pill's voice error state.
 */
export function routeTurnFailure(source: UserTurnSource, isInputOpen: boolean): TurnFailureAction {
  if (source === "voice") return { kind: "voice_error" };
  return isInputOpen ? { kind: "show_input_error" } : { kind: "none" };
}
