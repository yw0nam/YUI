import type { ScreenConfig } from "../load";
import { assertValid, ConfigError, isObject } from "./shared";

const KEYS = [
  "prev_dwell_ms",
  "settle_ms",
  "long_session_ms",
  "min_gap_ms",
  "quiet_after_turn_ms",
  "recent_cap",
] as const;

export function validateScreen(file: string, raw: unknown): ScreenConfig {
  if (!isObject(raw)) throw new ConfigError(file, ["객체가 아님"]);
  const issues: string[] = [];

  const out = {} as Record<(typeof KEYS)[number], number>;
  for (const key of KEYS) {
    const v = raw[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      issues.push(`${key}는 0 이상 유한 number여야 함 (받음: ${JSON.stringify(v)})`);
      continue;
    }
    out[key] = v;
  }

  assertValid(file, issues);
  return out as ScreenConfig;
}
