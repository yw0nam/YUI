import { assertValid, ConfigError, isObject } from "./shared";

/**
 * configs/screen.json — frontmost-transition detector thresholds (screen-source).
 * All six are surfaced as UI knobs; the client reads them live on every tick.
 */
export interface ScreenConfig {
  /** The departed app must have held the foreground this long for a switch to count. */
  prev_dwell_ms: number;
  /** The new app must hold the foreground this long before the switch fires. */
  settle_ms: number;
  /** One app holding the foreground this long marks a long session, re-marking each period. */
  long_session_ms: number;
  /** Minimum spacing between screen fires. */
  min_gap_ms: number;
  /** No screen fire within this long of a backend turn from any producer. */
  quiet_after_turn_ms: number;
  /** Max app_switched transitions held during a pacer gap; oldest dropped on overflow. 0 = accumulate nothing. */
  recent_cap: number;
}

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
