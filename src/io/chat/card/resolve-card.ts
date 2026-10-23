import type { Card, Locale, PersonaConfig } from "../../../config/validators/persona/types";
import type { EndpointsConfig } from "../../../contract";
import type { AgentSettings } from "../../../settings/backend/agent-settings";
import { DEFAULT_PRESET_ID } from "../../../settings/preset/preset-keys";

interface PresetEntry {
  id: string;
  name: string;
}

/** The card's effective name: the preset's, or the card's own while the built-in preset still carries its id as its name. */
export function cardName(card: Card, presetEntry: PresetEntry): string {
  const unnamedBuiltIn =
    presetEntry.id === DEFAULT_PRESET_ID && presetEntry.name === DEFAULT_PRESET_ID;
  return unnamedBuiltIn ? card.name : presetEntry.name;
}

/** The card a preset sends and its effective name; null on push or with the switch off. */
export function resolveCard(input: {
  settings: AgentSettings;
  locale: Locale;
  persona: PersonaConfig;
  presetEntry: PresetEntry;
  chatApi: EndpointsConfig["chat_api"];
}): { card: Card; charName: string } | null {
  const { settings, locale, persona, presetEntry, chatApi } = input;
  if (chatApi === "push" || !settings.send_card) return null;
  const card = settings.card ?? persona.cards[locale];
  return { card, charName: cardName(card, presetEntry) };
}
