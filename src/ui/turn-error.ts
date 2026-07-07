/**
 * Backend-call failure reason → inline input-error message (issue #274).
 *
 * Delegates to the i18n dictionary. Only the three reasons a user-initiated turn can
 * actually fail with (see dispatcher.ts's onUserTurnFailed) map to a message;
 * anything else renders nothing rather than inventing text.
 */

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
