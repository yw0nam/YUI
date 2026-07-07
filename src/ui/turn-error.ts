/**
 * Backend-call failure reason → inline input-error message (issue #274).
 *
 * Delegates to the i18n dictionary. Only the three reasons a user-initiated turn can
 * actually fail with (see dispatcher.ts's onUserTurnFailed) map to a message;
 * anything else renders nothing rather than inventing text.
 */

import type { UserTurnSource } from "../dispatcher/dispatcher";
import type { DropReason } from "../dispatcher/guardrails";
import { t } from "./i18n";

export function turnErrorMessage(reason: DropReason): string | undefined {
  switch (reason) {
    case "http_4xx_drop":
      return t("input.error_auth");
    case "network_drop":
      return t("input.error_network");
    case "parse_error":
      return t("input.error_parse");
    default:
      return undefined;
  }
}

export type TurnFailureAction =
  | { kind: "show_input_error" }
  | { kind: "voice_error" }
  | { kind: "none" };

/**
 * Routes a classified user-turn failure to the UI surface it belongs to. Routes by
 * `source` (which trigger actually failed), not by the input form's CURRENT open
 * state alone — a typed turn dismissed with Escape mid-flight must not get
 * misrouted to the voice indicator just because the form happens to be closed by
 * the time the failure arrives.
 *  - text + input open   -> the inline input error.
 *  - text + input closed -> nothing (the user already dismissed it; log-only).
 *  - voice                -> always the voice-input-indicator error state.
 */
export function routeTurnFailure(source: UserTurnSource, isInputOpen: boolean): TurnFailureAction {
  if (source === "voice") return { kind: "voice_error" };
  return isInputOpen ? { kind: "show_input_error" } : { kind: "none" };
}
