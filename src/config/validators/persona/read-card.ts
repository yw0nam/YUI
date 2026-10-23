import { isObject } from "../shared";
import { CARD_FIELD_MAX_LEN, CARD_TEXT_FIELDS, type Card, EMPTY_CARD } from "./types";

const V3_ONLY_FIELDS = [
  "nickname",
  "assets",
  "creator_notes_multilingual",
  "source",
  "group_only_greetings",
  "creation_date",
  "modification_date",
];

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === "string");
}

function emptyCard(): Card {
  return structuredClone(EMPTY_CARD) as Card;
}

/** Reads a V1 object or a V2/V3 envelope into a Card; missing or mistyped fields read as empty. */
export function readCard(raw: unknown): { card: Card; issues: string[] } {
  if (!isObject(raw)) return { card: emptyCard(), issues: ["card is not an object"] };
  const { spec } = raw;
  if (spec !== undefined && spec !== "chara_card_v2" && spec !== "chara_card_v3") {
    return { card: emptyCard(), issues: [`unknown spec ${JSON.stringify(spec)}`] };
  }
  const data = spec === undefined ? raw : isObject(raw.data) ? raw.data : {};
  const cap = (key: keyof Card, s: string): string =>
    CARD_TEXT_FIELDS.includes(key) ? s.slice(0, CARD_FIELD_MAX_LEN) : s;

  const card: Record<string, unknown> = {};
  for (const key of Object.keys(EMPTY_CARD) as (keyof Card)[]) {
    const v = data[key];
    const empty = EMPTY_CARD[key];
    if (typeof empty === "string") card[key] = typeof v === "string" ? cap(key, v) : "";
    else if (Array.isArray(empty)) card[key] = isStringArray(v) ? v.map((s) => cap(key, s)) : [];
    else card[key] = isObject(v) ? { ...v } : {};
  }
  if (spec === "chara_card_v3") {
    const v3 = Object.fromEntries(V3_ONLY_FIELDS.filter((k) => k in data).map((k) => [k, data[k]]));
    if (Object.keys(v3).length > 0) {
      card.extensions = { ...(card.extensions as object), chara_card_v3: v3 };
    }
  }
  return { card: card as unknown as Card, issues: [] };
}
