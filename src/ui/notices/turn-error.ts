/**
 * Backend-call failure reason → inline input-error message.
 *
 * Delegates to the i18n dictionary. Only the reasons a user-initiated turn can
 * actually fail with (see dispatcher.ts's onUserTurnFailed) map to a message;
 * anything else renders nothing rather than inventing text. A network_drop carrying
 * the server's {status, message} detail renders the status and the server text.
 */

import type { TurnErrorDetail, TurnFailure } from "../../dispatcher/backend/backend-caller";
import type { UserTurnSource } from "../../dispatcher/core/classify";
import type { InputErrorAction } from "../../io/bridge/message-remote";
import { t } from "../i18n";
import type { QuickControlsTab } from "../quick-controls/constants";

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
      if (detail) {
        // One application collapses the message's newlines AND keeps the whole rendered
        // line (status included) inside the 200-character budget.
        return collapseServerMessage(
          t("input.error_http", { status: detail.status, message: detail.message }),
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

/**
 * Whether the settings panel can resolve a failure. Only an unconfigured backend
 * qualifies — every other failure is outside the panel. Takes a raw string because
 * the status pill reads its reason off an untyped status detail.
 */
export function isSettingsFixable(reason: string): boolean {
  return reason === "not_configured";
}

/**
 * The in-place fix an inline error carries, if the host opens a settings panel that can resolve it.
 * The label names the destination, so the message itself only states the condition.
 */
export function turnErrorFixAction(
  reason: TurnFailure,
  openSettings?: (tab: QuickControlsTab) => void,
): InputErrorAction | undefined {
  if (!openSettings || !isSettingsFixable(reason)) return undefined;
  return { label: t("input.error_open_connection"), onClick: () => openSettings("conn") };
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
