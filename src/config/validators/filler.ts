import type { FillerConfig, FillerLang, FillerPool } from "../load";
import { assertValid, ConfigError, isObject } from "./shared";

const FILLER_LANGS: readonly FillerLang[] = ["ja", "en", "ko"];

/** Validates a string[] filler tier (first, repeat, long_wait, timeout, unreachable). Returns cleaned array or records issues. */
export function validateFillerTier(issues: string[], tier: unknown, path: string): string[] {
  if (!Array.isArray(tier)) {
    issues.push(`${path}는 배열이어야 함 (받음: ${JSON.stringify(tier)})`);
    return [];
  }
  const out: string[] = [];
  let clean = true;
  for (let i = 0; i < tier.length; i++) {
    if (typeof tier[i] !== "string") {
      issues.push(`${path}[${i}]는 문자열이어야 함 (받음: ${JSON.stringify(tier[i])})`);
      clean = false;
    } else {
      out.push(tier[i] as string);
    }
  }
  return clean ? out : [];
}

/** Validates the tool tier — an object of tool_id (or "_default") to a string[] tier. */
export function validateFillerToolTier(
  issues: string[],
  tool: unknown,
  path: string,
): Record<string, string[]> {
  if (!isObject(tool)) {
    issues.push(`${path}는 객체여야 함 (받음: ${JSON.stringify(tool)})`);
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
  if (!isObject(raw)) throw new ConfigError(file, ["객체가 아님"]);
  const issues: string[] = [];

  /** Whether obj[key] is a finite number ≥ 0. Otherwise records an issue and returns 0. */
  const nonNegNum = (key: string): number => {
    const v = raw[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      issues.push(`${key}는 0 이상 유한 number여야 함 (받음: ${JSON.stringify(v)})`);
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
    issues.push(`max_repeats는 0 이상 정수여야 함 (받음: ${JSON.stringify(max_repeats_raw)})`);
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
    issues.push(`gap_growth는 1 이상 유한 number여야 함 (받음: ${JSON.stringify(gap_growth_raw)})`);
  } else {
    gap_growth = gap_growth_raw;
  }

  // pools: object whose keys are restricted to FillerLang; each value is a full FillerPool —
  // every tier required (config is ours, no "old data" concern the way user settings have).
  const rawPools = raw.pools;
  const pools: Partial<Record<FillerLang, FillerPool>> = {};
  if (!isObject(rawPools)) {
    issues.push(`pools는 객체여야 함 (받음: ${JSON.stringify(rawPools)})`);
  } else if (Object.keys(rawPools).length === 0) {
    issues.push("pools는 최소 한 개의 언어(ja | en | ko)를 포함해야 함");
  } else {
    for (const key of Object.keys(rawPools)) {
      if (!(FILLER_LANGS as readonly string[]).includes(key)) {
        issues.push(`pools의 알 수 없는 키: ${JSON.stringify(key)} (허용: ja | en | ko)`);
        continue;
      }
      const lang = key as FillerLang;
      const entry = rawPools[lang];
      if (!isObject(entry)) {
        issues.push(`pools.${lang}는 객체여야 함 (받음: ${JSON.stringify(entry)})`);
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
  return { gap_ms, gap_jitter_ms, max_repeats, gap_growth, pools };
}
