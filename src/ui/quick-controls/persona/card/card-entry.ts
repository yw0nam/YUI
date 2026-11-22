/** The preset this window edits, and the card an edit starts from. */

import {
  type Card,
  EMPTY_CARD,
  type PersonaConfig,
} from "../../../../config/validators/persona/types";
import type { createAgentSettings } from "../../../../settings/backend/agent-settings";
import {
  type PresetEntry,
  presetIdForWindow,
  readPresetEntry,
  readPresetName,
} from "../../../../settings/preset/active-preset";
import { getLocale } from "../../../i18n";

/** The preset this window edits. */
export function presetEntry(): PresetEntry {
  const id = presetIdForWindow();
  return readPresetEntry(id) ?? { id, name: readPresetName(id) };
}

/** The card the preset sends: the user's own card, else the default card of the UI language. */
export function currentCard(
  agentSettings: Pick<ReturnType<typeof createAgentSettings>, "current">,
  getPersona?: () => PersonaConfig | undefined,
): Card {
  return agentSettings.current().card ?? cardBase(getPersona);
}

/** The default card of the UI language: what a first edit starts from. */
export function cardBase(getPersona?: () => PersonaConfig | undefined): Card {
  return getPersona?.()?.cards[getLocale()] ?? EMPTY_CARD;
}
