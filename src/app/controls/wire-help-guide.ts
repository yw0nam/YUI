/**
 * Help-section requests: submits a guide request as a user turn, whether the press came from this
 * window's panel or from the separate settings window over the bridge.
 */

import type { GuideKey } from "../../contract";
import type { UserInputSource } from "../../dispatcher/sources/user-input-source";
import type { SettingsBridge } from "../../io/bridge/settings-bridge";

export function wireHelpGuide(deps: {
  userInput: Pick<UserInputSource, "submitGuide">;
  bridge: Pick<SettingsBridge, "onHelpGuide">;
  register: (teardown: () => void) => void;
}): (guide: GuideKey, text: string) => void {
  const ask = (guide: GuideKey, text: string): void => deps.userInput.submitGuide(guide, text);
  deps.register(deps.bridge.onHelpGuide(({ guide, text }) => ask(guide, text)));
  return ask;
}
