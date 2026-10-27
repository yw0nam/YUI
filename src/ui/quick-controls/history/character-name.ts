/** The name the edited character goes by: its preset's, or its card's while the built-in preset is unnamed. */

import type { PersonaConfig } from "../../../config/validators/persona/types";
import { cardName } from "../../../io/chat/card/resolve-card";
import type { AgentSettings } from "../../../settings/backend/agent-settings";
import { presetIdForWindow, readPresetName } from "../../../settings/preset/active-preset";
import { getLocale } from "../../i18n";

export function editedCharacterName(
  agent: AgentSettings,
  persona: PersonaConfig | undefined,
): string {
  const id = presetIdForWindow();
  const entry = { id, name: readPresetName(id) };
  const card = agent.card ?? persona?.cards[getLocale()];
  return card ? cardName(card, entry) : entry.name;
}
