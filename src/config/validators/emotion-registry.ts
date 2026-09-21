import type { EmotionId, EmotionRegistry, EmotionRegistryEntry } from "../../contract";
import { assertValid, ConfigError, isObject } from "./shared";

/** 10 emotion enum values. Registry keys are limited to this set (typo keys fail-loud). */
export const EMOTION_IDS: ReadonlySet<EmotionId> = new Set<EmotionId>([
  "neutral",
  "happy",
  "angry",
  "sad",
  "relaxed",
  "surprised",
  "thinking",
  "curious",
  "sleepy",
  "embarrassed",
]);

export function validateEmotionRegistry(file: string, raw: unknown): EmotionRegistry {
  if (!isObject(raw)) throw new ConfigError(file, ["not an object"]);
  const issues: string[] = [];
  const out: EmotionRegistry = {};
  for (const [id, entry] of Object.entries(raw)) {
    if (!EMOTION_IDS.has(id as EmotionId)) {
      issues.push(`${id}: not a known emotion id`);
      continue;
    }
    if (!isObject(entry)) {
      issues.push(`${id}: entry is not an object`);
      continue;
    }
    if (typeof entry.vrm_expression !== "string") {
      issues.push(`${id}.vrm_expression must be a string`);
      continue;
    }
    if (typeof entry.fallback !== "string") {
      issues.push(`${id}.fallback must be a string`);
      continue;
    }
    out[id as EmotionId] = {
      vrm_expression: entry.vrm_expression,
      fallback: entry.fallback,
    } satisfies EmotionRegistryEntry;
  }
  assertValid(file, issues);
  return out;
}
