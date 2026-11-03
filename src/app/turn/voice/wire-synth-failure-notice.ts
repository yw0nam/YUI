/**
 * wireSynthFailureNotice — once per pet-window run, a reply whose speech failed to synthesize
 * offers a "choose another voice" action under its bubble when that reply ends, opening the
 * Voice settings page. Shown actions hold the bubble open, so the action stays until the user
 * acts or the next speech begins. A failure of the greeting, or of a reply while the unified chat
 * window is shown (its bubble is hidden), leaves the notice armed for a later reply's failure.
 */

import type { UtteranceIdentity } from "../../../contract";
import type { SettingsPage } from "../../../settings/panels/settings-pages";
import type { Surfaces } from "../../../ui/surfaces/surfaces";

export function wireSynthFailureNotice(deps: {
  /** A backend utterance's sentence failed to synthesize. */
  onSynthFailure: (cb: () => void) => () => void;
  onUtteranceEnd: (cb: (identity: UtteranceIdentity) => void) => () => void;
  surfaces: Pick<Surfaces, "showSpeechActions" | "hideSpeech">;
  openSettings: (page: SettingsPage) => void;
  /** The unified chat window is shown: the reply sits in its stream and the pet bubble is hidden. */
  isUnifiedShown: () => boolean;
  t: (key: string) => string;
}): { dispose: () => void } {
  let offered = false;
  // A sentence of the playing utterance failed; its synth settles before its end is reported.
  let failed = false;
  const unsubscribeFailure = deps.onSynthFailure(() => {
    failed = true;
  });
  const unsubscribeEnd = deps.onUtteranceEnd((identity) => {
    const show = failed && !offered && identity.event_name !== "greeting" && !deps.isUnifiedShown();
    failed = false;
    if (!show) return;
    offered = true;
    deps.surfaces.showSpeechActions([
      {
        label: deps.t("voice.synth_failed_action"),
        onClick: () => {
          deps.surfaces.hideSpeech();
          deps.openSettings("voice");
        },
      },
    ]);
  });
  return {
    dispose: () => {
      unsubscribeFailure();
      unsubscribeEnd();
    },
  };
}
