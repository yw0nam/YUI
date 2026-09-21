import type { AttachmentLimits, GuardrailsConfig } from "../load";
import { assertValid, ConfigError, isObject } from "./shared";

export function validateGuardrails(file: string, raw: unknown): GuardrailsConfig {
  if (!isObject(raw)) throw new ConfigError(file, ["not an object"]);
  const issues: string[] = [];

  /** Whether obj[key] is a finite number ≥ 0. Otherwise records an issue and returns 0. */
  const nonNegNum = (obj: Record<string, unknown>, path: string, key: string): number => {
    const v = obj[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      issues.push(`${path}.${key} must be a finite number >= 0 (got: ${JSON.stringify(v)})`);
      return 0;
    }
    return v;
  };

  // debounce_ms
  const rawDebounce = raw.debounce_ms;
  const debounce_ms = {
    os_event_watcher: 0,
    user_input_source: 0,
    screen_watcher: 0,
  };
  if (!isObject(rawDebounce)) {
    issues.push(`debounce_ms must be an object (got: ${JSON.stringify(rawDebounce)})`);
  } else {
    for (const k of Object.keys(debounce_ms) as (keyof typeof debounce_ms)[]) {
      debounce_ms[k] = nonNegNum(rawDebounce, "debounce_ms", k);
    }
  }

  // rate_limit
  const rawRate = raw.rate_limit;
  const rate_limit = { window_ms: 0, tier2_max: 0, tier3_max: 0, overall_max: 0, cooldown_ms: 0 };
  if (!isObject(rawRate)) {
    issues.push(`rate_limit must be an object (got: ${JSON.stringify(rawRate)})`);
  } else {
    for (const k of Object.keys(rate_limit) as (keyof typeof rate_limit)[]) {
      rate_limit[k] = nonNegNum(rawRate, "rate_limit", k);
    }
  }

  // attachments
  const rawAttachments = raw.attachments;
  const attachments = { max_count: 0, max_image_bytes: 0 };
  if (!isObject(rawAttachments)) {
    issues.push(`attachments must be an object (got: ${JSON.stringify(rawAttachments)})`);
  } else {
    for (const k of Object.keys(attachments) as (keyof AttachmentLimits)[]) {
      attachments[k] = nonNegNum(rawAttachments, "attachments", k);
    }
  }

  assertValid(file, issues);
  return { debounce_ms, rate_limit, attachments };
}
