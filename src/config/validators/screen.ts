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
  if (!isObject(raw)) throw new ConfigError(file, ["not an object"]);
  const issues: string[] = [];

  const out = {} as Record<(typeof KEYS)[number], number>;
  for (const key of KEYS) {
    const v = raw[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      issues.push(`${key} must be a finite number >= 0 (got: ${JSON.stringify(v)})`);
      continue;
    }
    out[key] = v;
  }

  assertValid(file, issues);
  return out as ScreenConfig;
}
