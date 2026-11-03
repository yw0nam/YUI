/**
 * wireSynthFailureNotice — once per pet-window run, the first real synth failure offers an
 * "choose another voice" action under the speech bubble, opening the Voice settings page.
 * A failure while the unified chat window is shown is not the notice's moment: the reply sits
 * in that window's stream and the action would hang under a hidden bubble, so the notice stays
 * armed for the next failure after it closes.
 */

import type { SettingsPage } from "../../../settings/panels/settings-pages";
import type { Surfaces } from "../../../ui/surfaces/surfaces";

export function wireSynthFailureNotice(deps: {
  onSynthFailure: (cb: () => void) => () => void;
  surfaces: Pick<Surfaces, "showSpeechActions" | "hideSpeech">;
  openSettings: (page: SettingsPage) => void;
  /** The unified chat window is shown: the reply sits in its stream and the pet bubble is hidden. */
  isUnifiedShown: () => boolean;
  t: (key: string) => string;
}): { dispose: () => void } {
  let offered = false;
  const unsubscribe = deps.onSynthFailure(() => {
    if (deps.isUnifiedShown() || offered) return;
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
  return { dispose: unsubscribe };
}
