import { assertValid, ConfigError, isObject } from "../shared";
import { readCard } from "./read-card";
import { type Card, EMPTY_CARD, type Locale, type PersonaConfig } from "./types";

const LOCALES: readonly Locale[] = ["en", "ja", "ko"];
const REQUIRED_TEXT: readonly (keyof Card)[] = ["name", "description", "first_mes"];

function localeStrings(issues: string[], v: unknown, path: string): Record<Locale, string> {
  const out = { en: "", ja: "", ko: "" };
  if (!isObject(v)) {
    issues.push(`${path} must be an object (got: ${JSON.stringify(v)})`);
    return out;
  }
  for (const loc of LOCALES) {
    const s = v[loc];
    if (typeof s === "string" && s.trim()) out[loc] = s;
    else issues.push(`${path}.${loc} must be a non-empty string (got: ${JSON.stringify(s)})`);
  }
  return out;
}

function checkCardData(issues: string[], data: Record<string, unknown>, path: string): void {
  for (const key of Object.keys(EMPTY_CARD) as (keyof Card)[]) {
    const v = data[key];
    const empty = EMPTY_CARD[key];
    const field = `${path}.${key}`;
    if (typeof empty === "string") {
      if (typeof v !== "string")
        issues.push(`${field} must be a string (got: ${JSON.stringify(v)})`);
      else if (REQUIRED_TEXT.includes(key) && !v.trim()) issues.push(`${field} must be non-empty`);
    } else if (Array.isArray(empty)) {
      if (!Array.isArray(v) || v.some((s) => typeof s !== "string")) {
        issues.push(`${field} must be a string[] (got: ${JSON.stringify(v)})`);
      }
    } else if (!isObject(v)) {
      issues.push(`${field} must be an object (got: ${JSON.stringify(v)})`);
    }
  }
}

export function validatePersona(file: string, raw: unknown): PersonaConfig {
  if (!isObject(raw)) throw new ConfigError(file, ["not an object"]);
  const issues: string[] = [];
  const framing = localeStrings(issues, raw.framing, "framing");
  const user_fallback = localeStrings(issues, raw.user_fallback, "user_fallback");
  const cards = {} as Record<Locale, Card>;
  if (!isObject(raw.cards)) {
    issues.push(`cards must be an object (got: ${JSON.stringify(raw.cards)})`);
  } else {
    for (const loc of LOCALES) {
      const env = raw.cards[loc];
      const path = `cards.${loc}`;
      if (!isObject(env)) issues.push(`${path} must be an object (got: ${JSON.stringify(env)})`);
      else if (env.spec !== "chara_card_v2") {
        issues.push(`${path}.spec must be "chara_card_v2" (got: ${JSON.stringify(env.spec)})`);
      } else if (!isObject(env.data)) issues.push(`${path}.data must be an object`);
      else checkCardData(issues, env.data, `${path}.data`);
      cards[loc] = readCard(env).card;
    }
  }
  assertValid(file, issues);
  return { framing, user_fallback, cards };
}
