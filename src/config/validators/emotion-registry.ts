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
  if (!isObject(raw)) throw new ConfigError(file, ["객체가 아님"]);
  const issues: string[] = [];
  const out: EmotionRegistry = {};
  for (const [id, entry] of Object.entries(raw)) {
    if (!EMOTION_IDS.has(id as EmotionId)) {
      issues.push(`${id}: 알 수 없는 emotion id (enum 외)`);
      continue;
    }
    if (!isObject(entry)) {
      issues.push(`${id}: 항목이 객체가 아님`);
      continue;
    }
    if (typeof entry.vrm_expression !== "string") {
      issues.push(`${id}.vrm_expression은 문자열이어야 함`);
      continue;
    }
    if (typeof entry.fallback !== "string") {
      issues.push(`${id}.fallback은 문자열이어야 함`);
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
