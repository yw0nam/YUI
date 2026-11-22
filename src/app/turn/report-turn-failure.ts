/** Routes a failed user turn to the open input's error line, or to the status pill's notice when no input is open. */

import type { TurnErrorDetail, TurnFailure } from "../../dispatcher/backend/backend-caller";
import type { UserTurnSource } from "../../dispatcher/core/classify";
import type { SettingsFocus, SettingsPage } from "../../settings/panels/settings-pages";
import type { TurnNoticeStore } from "../../ui/chips/turn-notice";
import {
  failureAction,
  fixAction,
  routeTurnFailure,
  turnErrorMessage,
} from "../../ui/notices/turn-error";
import type { Surfaces } from "../../ui/surfaces/surfaces";

export function createTurnFailureReporter(deps: {
  surfaces: Pick<Surfaces, "isInputOpen" | "showInputError">;
  openSettings?: (tab: SettingsPage, focus?: SettingsFocus) => void;
  turnNotice: Pick<TurnNoticeStore, "show">;
  /** The voice error state the status pill's mic shows beside the notice. */
  showVoiceError: (reason: string, message?: string) => void;
}): (reason: TurnFailure, source: UserTurnSource, detail?: TurnErrorDetail) => void {
  const { surfaces, openSettings, turnNotice, showVoiceError } = deps;
  return (reason, source, detail) => {
    const message = turnErrorMessage(reason, detail);
    if (!message) return;
    const next = failureAction(reason, detail);
    const route = routeTurnFailure(source, surfaces.isInputOpen());
    if (route.kind === "show_input_error") {
      surfaces.showInputError(message, next === "retry" ? next : fixAction(next, openSettings));
      return;
    }
    turnNotice.show({ message, action: fixAction(next, openSettings) });
    if (route.kind === "voice_error") showVoiceError(reason, detail ? message : undefined);
  };
}
