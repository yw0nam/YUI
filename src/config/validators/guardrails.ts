import { assertValid, ConfigError, isObject } from "./shared";

/** Attach-time caps on one turn's image attachments. */
export interface AttachmentLimits {
  /** Max images held for one turn. Further attachments are refused. */
  max_count: number;
  /** Max source-file size (bytes) for one image. Larger files are refused. */
  max_image_bytes: number;
}

/** configs/guardrails.json — debounce/rate-limit values. */
export interface GuardrailsConfig {
  /** per-source debounce window (ms). 0 = no debounce. */
  debounce_ms: {
    os_event_watcher: number;
    user_input_source: number;
    screen_watcher: number;
  };
  /** rolling rate-limit. */
  rate_limit: {
    /** rolling window length (ms). */
    window_ms: number;
    /** tier2 cap. */
    tier2_max: number;
    /** overall cap on backend calls — entering cooldown when exceeded. */
    overall_max: number;
    /** cooldown duration (ms) after overall is exceeded. */
    cooldown_ms: number;
  };
  /** attach-time caps on turn attachments. */
  attachments: AttachmentLimits;
}

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
  const rate_limit = { window_ms: 0, tier2_max: 0, overall_max: 0, cooldown_ms: 0 };
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
