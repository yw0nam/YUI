/** Help-section requests: submits a guide request the settings window sends over the bridge as a user turn. */

import type { GuideKey } from "../../contract";
import type { UserInputSource } from "../../dispatcher/sources/user-input-source";
import type { SettingsBridge } from "../../io/bridge/settings-bridge";

export function wireHelpGuide(deps: {
  userInput: Pick<UserInputSource, "submitGuide">;
  bridge: Pick<SettingsBridge, "onHelpGuide">;
  register: (teardown: () => void) => void;
}): {
  /** The proactive source exists only after config loads; a press counts as interaction from then on. */
  bindInteraction: (noteInteraction: () => void) => void;
} {
  let noteInteraction = (): void => {};
  const ask = (guide: GuideKey, text: string): void => {
    deps.userInput.submitGuide(guide, text);
    noteInteraction();
  };
  deps.register(deps.bridge.onHelpGuide(({ guide, text }) => ask(guide, text)));
  return {
    bindInteraction: (fn) => {
      noteInteraction = fn;
    },
  };
}
