import type { FillerConfig, FillerLang, FillerPool } from "../load";
import { assertValid, ConfigError, isObject } from "./shared";

const FILLER_LANGS: readonly FillerLang[] = ["ja", "en", "ko"];

/** Validates a string[] filler tier (first or repeat). Returns cleaned array or records issues. */
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

export function validateFiller(file: string, raw: unknown): FillerConfig {
  if (!isObject(raw)) throw new ConfigError(file, ["객체가 아님"]);
  const issues: string[] = [];

  /** obj[key]가 유한 number ≥ 0인지. 아니면 issue 추가하고 0 반환. */
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

  // pools: object whose keys are restricted to FillerLang; each value is {first, repeat}
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
        issues.push(`pools.${lang}는 {first, repeat} 객체여야 함 (받음: ${JSON.stringify(entry)})`);
        continue;
      }
      const first = validateFillerTier(issues, entry.first, `pools.${lang}.first`);
      const repeat = validateFillerTier(issues, entry.repeat, `pools.${lang}.repeat`);
      pools[lang] = { first, repeat };
    }
  }

  assertValid(file, issues);
  return { gap_ms, gap_jitter_ms, pools };
}
