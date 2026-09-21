import type { FillerConfig, FillerLang, FillerPool } from "../load";
import { assertValid, ConfigError, isObject } from "./shared";

const FILLER_LANGS: readonly FillerLang[] = ["ja", "en", "ko"];

/** Validates a string[] filler tier (first, repeat, long_wait, timeout, unreachable). Returns cleaned array or records issues. */
function validateFillerTier(issues: string[], tier: unknown, path: string): string[] {
  if (!Array.isArray(tier)) {
    issues.push(`${path} must be an array (got: ${JSON.stringify(tier)})`);
    return [];
  }
  const out: string[] = [];
  let clean = true;
  for (let i = 0; i < tier.length; i++) {
    if (typeof tier[i] !== "string") {
      issues.push(`${path}[${i}] must be a string (got: ${JSON.stringify(tier[i])})`);
      clean = false;
    } else {
      out.push(tier[i] as string);
    }
  }
  return clean ? out : [];
}

/** Validates the tool tier — an object of tool_id (or "_default") to a string[] tier. */
function validateFillerToolTier(
  issues: string[],
  tool: unknown,
  path: string,
): Record<string, string[]> {
  if (!isObject(tool)) {
    issues.push(`${path} must be an object (got: ${JSON.stringify(tool)})`);
    return {};
  }
  const out: Record<string, string[]> = {};
  let clean = true;
  for (const key of Object.keys(tool)) {
    const before = issues.length;
    const list = validateFillerTier(issues, tool[key], `${path}.${key}`);
    if (issues.length > before) clean = false;
    else out[key] = list;
  }
  return clean ? out : {};
}

export function validateFiller(file: string, raw: unknown): FillerConfig {
  if (!isObject(raw)) throw new ConfigError(file, ["not an object"]);
  const issues: string[] = [];

  /** Whether obj[key] is a finite number ≥ 0. Otherwise records an issue and returns 0. */
  const nonNegNum = (key: string): number => {
    const v = raw[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      issues.push(`${key} must be a finite number >= 0 (got: ${JSON.stringify(v)})`);
      return 0;
    }
    return v;
  };

  const gap_ms = nonNegNum("gap_ms");
  const gap_jitter_ms = nonNegNum("gap_jitter_ms");

  const max_repeats_raw = raw.max_repeats;
  let max_repeats = 0;
  if (
    typeof max_repeats_raw !== "number" ||
    !Number.isInteger(max_repeats_raw) ||
    max_repeats_raw < 0
  ) {
    issues.push(`max_repeats must be an integer >= 0 (got: ${JSON.stringify(max_repeats_raw)})`);
  } else {
    max_repeats = max_repeats_raw;
  }

  const gap_growth_raw = raw.gap_growth;
  let gap_growth = 1;
  if (
    typeof gap_growth_raw !== "number" ||
    !Number.isFinite(gap_growth_raw) ||
    gap_growth_raw < 1
  ) {
    issues.push(`gap_growth must be a finite number >= 1 (got: ${JSON.stringify(gap_growth_raw)})`);
  } else {
    gap_growth = gap_growth_raw;
  }

  const long_wait_ms = nonNegNum("long_wait_ms");

  // pools: object whose keys are restricted to FillerLang; each value is a full FillerPool —
  // every tier required (config is ours, no "old data" concern the way user settings have).
  const rawPools = raw.pools;
  const pools: Partial<Record<FillerLang, FillerPool>> = {};
  if (!isObject(rawPools)) {
    issues.push(`pools must be an object (got: ${JSON.stringify(rawPools)})`);
  } else if (Object.keys(rawPools).length === 0) {
    issues.push("pools must contain at least one language (ja | en | ko)");
  } else {
    for (const key of Object.keys(rawPools)) {
      if (!(FILLER_LANGS as readonly string[]).includes(key)) {
        issues.push(`pools.${key} is an unknown key (allowed: ja | en | ko)`);
        continue;
      }
      const lang = key as FillerLang;
      const entry = rawPools[lang];
      if (!isObject(entry)) {
        issues.push(`pools.${lang} must be an object (got: ${JSON.stringify(entry)})`);
        continue;
      }
      const first = validateFillerTier(issues, entry.first, `pools.${lang}.first`);
      const repeat = validateFillerTier(issues, entry.repeat, `pools.${lang}.repeat`);
      const long_wait = validateFillerTier(issues, entry.long_wait, `pools.${lang}.long_wait`);
      const timeout = validateFillerTier(issues, entry.timeout, `pools.${lang}.timeout`);
      const unreachable = validateFillerTier(
        issues,
        entry.unreachable,
        `pools.${lang}.unreachable`,
      );
      const tool = validateFillerToolTier(issues, entry.tool, `pools.${lang}.tool`);
      pools[lang] = { first, repeat, long_wait, tool, timeout, unreachable };
    }
  }

  assertValid(file, issues);
  return { gap_ms, gap_jitter_ms, max_repeats, gap_growth, long_wait_ms, pools };
}
