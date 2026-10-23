/** A preset's persona text in Tavern Card V2 shape. */
export interface Card {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  system_prompt: string;
  post_history_instructions: string;
  alternate_greetings: string[];
  creator_notes: string;
  tags: string[];
  creator: string;
  character_version: string;
  extensions: Record<string, unknown>;
}

export const EMPTY_CARD: Readonly<Card> = Object.freeze({
  name: "",
  description: "",
  personality: "",
  scenario: "",
  first_mes: "",
  mes_example: "",
  creator_notes: "",
  system_prompt: "",
  post_history_instructions: "",
  alternate_greetings: [],
  tags: [],
  creator: "",
  character_version: "",
  extensions: {},
});

/** The fields the user edits; CARD_FIELD_MAX_LEN applies to these only. */
export const CARD_TEXT_FIELDS: readonly (keyof Card)[] = [
  "name",
  "description",
  "personality",
  "scenario",
  "first_mes",
  "alternate_greetings",
  "mes_example",
  "system_prompt",
  "post_history_instructions",
];

export const CARD_FIELD_MAX_LEN = 4000;

/** The UI languages a default card ships in. */
export type Locale = "en" | "ja" | "ko";

/** configs/persona.json — the default cards, the framing, and the `{{user}}` fallback word, per UI language. */
export interface PersonaConfig {
  framing: Record<Locale, string>;
  user_fallback: Record<Locale, string>;
  cards: Record<Locale, Card>;
}
