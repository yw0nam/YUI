/**
 * Reactive settings store managing the user-editable guardrail rate-limit caps.
 * 0 means "no override" — the cap falls back to the bundled configs/guardrails.json default.
 * Persists to storage on change and notifies subscribers. Never mutates the checked-in config.
 */

import type { GuardrailsConfig } from "../config/load";
import {
  applyPositiveOverrides,
  createOverrideRecordSettings,
  localStorageStore,
  type PersistedStorage,
  projectOverrides,
} from "./persisted-store";

/** Largest cap accepted — a stored value above it counts as no override. */
export const RATE_LIMIT_MAX = 999;

/** Editable rolling-window caps. 0 = no override. */
export interface RateLimitOverrides {
  tier2_max: number;
  tier3_max: number;
  overall_max: number;
}

export type GuardrailsStorage = PersistedStorage<RateLimitOverrides>;

/**
 * No override for any cap. Its keys are the store's key list, so a cap added to RateLimitOverrides
 * without an entry here fails to typecheck rather than silently losing its merge branch, its
 * setter, and its UI row.
 */
const EMPTY: RateLimitOverrides = { tier2_max: 0, tier3_max: 0, overall_max: 0 };

/** A settable cap: 0 (clear the override) or an integer in 1..RATE_LIMIT_MAX. */
function acceptCap(_key: keyof RateLimitOverrides, v: unknown): number | undefined {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= RATE_LIMIT_MAX
    ? v
    : undefined;
}

/**
 * Builds a new GuardrailsConfig by layering the edited caps onto the bundled one (base unchanged).
 * A cap of 0 keeps the config default; everything outside rate_limit passes through.
 */
export function mergeGuardrails(base: GuardrailsConfig, ov: RateLimitOverrides): GuardrailsConfig {
  return { ...base, rate_limit: applyPositiveOverrides(base.rate_limit, ov) };
}

/**
 * Projects a bundled GuardrailsConfig onto the RateLimitOverrides shape for the UI's fallback
 * display, dropping window_ms/cooldown_ms — the values this store never overrides.
 */
export function rateLimitDefaultsFromConfig(g: GuardrailsConfig): RateLimitOverrides {
  return projectOverrides(EMPTY, (key) => g.rate_limit[key]);
}

export function createGuardrailsSettings(opts?: { storage?: GuardrailsStorage }) {
  return createOverrideRecordSettings<RateLimitOverrides>({
    storage: opts?.storage,
    empty: EMPTY,
    accept: acceptCap,
  });
}

export type GuardrailsSettingsStore = ReturnType<typeof createGuardrailsSettings>;

/** localStorage-based GuardrailsStorage adapter. Gracefully ignored where localStorage is absent. */
export function localStorageGuardrailsStorage(key = "yui.guardrails"): GuardrailsStorage {
  return localStorageStore<RateLimitOverrides>(key);
}
