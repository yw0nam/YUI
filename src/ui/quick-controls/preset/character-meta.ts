/** A character's transport and window state, in the words the character header and the settings stage show. */

import { effectiveChatApi } from "../../../settings/backend/endpoints-settings";
import { t } from "../../i18n";

export type CharacterState = "head.main" | "preset.window_open" | "head.off";

/** `id`'s window state and its "{transport} · {state}" line, from its stored chat_api override over the bundled transport. */
export function characterMeta(p: {
  id: string;
  main: string;
  isOpen: (id: string) => boolean;
  chatApiOverride: string;
  defaultChatApi: string | undefined;
}): { state: CharacterState; line: string } {
  const state: CharacterState =
    p.id === p.main ? "head.main" : p.isOpen(p.id) ? "preset.window_open" : "head.off";
  const transport = t(`svc.chat_name_${effectiveChatApi(p.chatApiOverride, p.defaultChatApi)}`);
  return { state, line: t("head.meta", { transport, state: t(state) }) };
}
