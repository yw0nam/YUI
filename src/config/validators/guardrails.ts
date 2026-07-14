import type { GuardrailsConfig } from "../load";
import { assertValid, ConfigError, isObject } from "./shared";

export function validateGuardrails(file: string, raw: unknown): GuardrailsConfig {
  if (!isObject(raw)) throw new ConfigError(file, ["객체가 아님"]);
  const issues: string[] = [];

  /** obj[key]가 유한 number ≥ 0인지. 아니면 issue 추가하고 0 반환. */
  const nonNegNum = (obj: Record<string, unknown>, path: string, key: string): number => {
    const v = obj[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      issues.push(`${path}.${key}는 0 이상 유한 number여야 함 (받음: ${JSON.stringify(v)})`);
      return 0;
    }
    return v;
  };

  // dnd
  const rawDnd = raw.dnd;
  let app_blocklist: string[] = [];
  if (!isObject(rawDnd)) {
    issues.push(`dnd는 객체여야 함 (받음: ${JSON.stringify(rawDnd)})`);
  } else {
    const rawBlocklist = rawDnd.app_blocklist;
    if (!Array.isArray(rawBlocklist) || rawBlocklist.some((v) => typeof v !== "string")) {
      issues.push(`dnd.app_blocklist는 string[]이어야 함 (받음: ${JSON.stringify(rawBlocklist)})`);
    } else {
      app_blocklist = rawBlocklist as string[];
    }
  }

  // debounce_ms
  const rawDebounce = raw.debounce_ms;
  const debounce_ms = {
    idle_watcher: 0,
    os_event_watcher: 0,
    backend_push_source: 0,
    user_input_source: 0,
  };
  if (!isObject(rawDebounce)) {
    issues.push(`debounce_ms는 객체여야 함 (받음: ${JSON.stringify(rawDebounce)})`);
  } else {
    for (const k of Object.keys(debounce_ms) as (keyof typeof debounce_ms)[]) {
      debounce_ms[k] = nonNegNum(rawDebounce, "debounce_ms", k);
    }
  }

  // rate_limit
  const rawRate = raw.rate_limit;
  const rate_limit = { window_ms: 0, tier2_max: 0, tier3_max: 0, overall_max: 0, cooldown_ms: 0 };
  if (!isObject(rawRate)) {
    issues.push(`rate_limit는 객체여야 함 (받음: ${JSON.stringify(rawRate)})`);
  } else {
    for (const k of Object.keys(rate_limit) as (keyof typeof rate_limit)[]) {
      rate_limit[k] = nonNegNum(rawRate, "rate_limit", k);
    }
  }

  assertValid(file, issues);
  return { dnd: { app_blocklist }, debounce_ms, rate_limit };
}
