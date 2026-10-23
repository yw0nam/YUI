/**
 * The V2 export envelope — a Card as a `chara_card_v2` object under the preset's
 * effective name. V3-only extras stay where readCard put them, under
 * `extensions.chara_card_v3`.
 */

import type { Card } from "../../../config/validators/persona/types";

/** The V2 spec's field order; the envelope is written in it. */
const V2_FIELD_ORDER: readonly (keyof Card)[] = [
  "name",
  "description",
  "personality",
  "scenario",
  "first_mes",
  "mes_example",
  "creator_notes",
  "system_prompt",
  "post_history_instructions",
  "alternate_greetings",
  "tags",
  "creator",
  "character_version",
];

export interface CardV2Envelope {
  spec: "chara_card_v2";
  spec_version: "2.0";
  data: Record<string, unknown>;
}

export function toV2Envelope(card: Card, name: string): CardV2Envelope {
  const data: Record<string, unknown> = {};
  for (const key of V2_FIELD_ORDER) {
    data[key] = key === "name" ? name : card[key];
  }
  data.extensions = card.extensions;
  return { spec: "chara_card_v2", spec_version: "2.0", data };
}
