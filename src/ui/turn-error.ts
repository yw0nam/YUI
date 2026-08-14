/**
 * Backend-call failure reason → inline input-error message.
 *
 * Delegates to the i18n dictionary. Only the reasons a user-initiated turn can
 * actually fail with (see dispatcher.ts's onUserTurnFailed) map to a message;
 * anything else renders nothing rather than inventing text.
 */

import { IDLE_TIMEOUT_MS, type TurnFailure } from "../dispatcher/backend-caller";
import type { UserTurnSource } from "../dispatcher/dispatcher";
import { t } from "./i18n";
import type { QuickControlsTab } from "./quick-controls/constants";
import type { InputErrorAction } from "./text-input";

export function turnErrorMessage(reason: TurnFailure): string | undefined {
  switch (reason) {
    case "not_configured":
      return t("input.error_not_configured");
    case "http_4xx_drop":
      return t("input.error_auth");
    case "network_drop":
      return t("input.error_network");
    case "network_stall":
      // The deadline comes from the watchdog constant so the text can't drift from it.
      return t("input.error_stall", { seconds: IDLE_TIMEOUT_MS / 1000 });
    case "parse_error":
      return t("input.error_parse");
    default:
      return undefined;
  }
}

/**
 * Whether the settings panel can resolve a failure. Only an unconfigured backend
 * qualifies — every other failure is outside the panel. Takes a raw string because
 * the voice indicator reads its reason off an untyped status detail.
 */
export function isSettingsFixable(reason: string): boolean {
  return reason === "not_configured";
}

/**
 * The in-place fix an inline error carries, if the settings panel can resolve it.
 * The label names the destination, so the message itself only states the condition.
 */
export function turnErrorFixAction(
  reason: TurnFailure,
  openSettings: (tab: QuickControlsTab) => void,
): InputErrorAction | undefined {
  if (!isSettingsFixable(reason)) return undefined;
  return { label: t("input.error_open_advanced"), onClick: () => openSettings("adv") };
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
