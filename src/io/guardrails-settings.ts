/**
 * Reactive settings store managing the user-editable guardrail rate-limit caps.
 * 0 means "no override" — the cap falls back to the bundled configs/guardrails.json default.
 * Persists to storage on change and notifies subscribers. Never mutates the checked-in config.
 */

import type { GuardrailsConfig } from "../config/load";
import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

/** Largest cap accepted — a stored value above it counts as no override. */
export const RATE_LIMIT_MAX = 999;

/** Editable rolling-window caps. 0 = no override. */
export interface RateLimitOverrides {
  tier2_max: number;
  tier3_max: number;
  overall_max: number;
}

export const RATE_LIMIT_KEYS = [
  "tier2_max",
  "tier3_max",
  "overall_max",
] as const satisfies readonly (keyof RateLimitOverrides)[];

/**
 * Compile-time totality guard: a cap added to RateLimitOverrides without a matching key above
 * stops `_MissingRateLimitKeys` from being `never`, so `pnpm build` catches the gap rather than
 * the cap silently losing its merge branch, its setter, and its UI row.
 */
type _MissingRateLimitKeys = Exclude<keyof RateLimitOverrides, (typeof RATE_LIMIT_KEYS)[number]>;
const _totalityGuard: _MissingRateLimitKeys extends never ? true : _MissingRateLimitKeys = true;
void _totalityGuard;

export type GuardrailsStorage = PersistedStorage<RateLimitOverrides>;

const EMPTY: RateLimitOverrides = { tier2_max: 0, tier3_max: 0, overall_max: 0 };

/** A settable cap: 0 (clear the override) or an integer in 1..RATE_LIMIT_MAX. */
function isCap(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= RATE_LIMIT_MAX;
}

/** Storage sanitation — a stored cap outside 1..RATE_LIMIT_MAX counts as no override. */
function coerceCap(v: unknown): number {
  return isCap(v) ? v : 0;
}

function coerce(v: unknown): RateLimitOverrides {
  const s = (v ?? {}) as Record<string, unknown>;
  const out = { ...EMPTY };
  for (const k of RATE_LIMIT_KEYS) out[k] = coerceCap(s[k]);
  return out;
}

function equals(a: RateLimitOverrides, b: RateLimitOverrides): boolean {
  return RATE_LIMIT_KEYS.every((k) => a[k] === b[k]);
}

/**
 * Builds a new GuardrailsConfig by layering the edited caps onto the bundled one (base unchanged).
 * A cap of 0 keeps the config default; everything outside rate_limit passes through.
 */
export function mergeGuardrails(base: GuardrailsConfig, ov: RateLimitOverrides): GuardrailsConfig {
  const rate_limit = { ...base.rate_limit };
  for (const key of RATE_LIMIT_KEYS) {
    if (ov[key] > 0) rate_limit[key] = ov[key];
  }
  return { ...base, rate_limit };
}

/**
 * Projects a bundled GuardrailsConfig onto the RateLimitOverrides shape for the UI's fallback
 * display, dropping window_ms/cooldown_ms — the values this store never overrides.
 */
export function rateLimitDefaultsFromConfig(g: GuardrailsConfig): RateLimitOverrides {
  const out = { ...EMPTY };
  for (const key of RATE_LIMIT_KEYS) out[key] = g.rate_limit[key];
  return out;
}

export function createGuardrailsSettings(opts?: {
  storage?: GuardrailsStorage;
  initial?: RateLimitOverrides;
}) {
  const core = createPersistedStore<RateLimitOverrides>({
    storage: opts?.storage,
    initial: opts?.initial,
    defaults: { ...EMPTY },
    parse: (v) => (v === null ? null : coerce(v)),
    fromInitial: coerce,
    equals,
  });

  return {
    get: core.get,

    /** An out-of-range value is ignored, so a typo never silently drops the cap already set. */
    set(partial: Partial<RateLimitOverrides>): void {
      const next = { ...core.current() };
      for (const k of RATE_LIMIT_KEYS) {
        const v = partial[k];
        if (k in partial && isCap(v)) next[k] = v;
      }
      core.commit(next);
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

export type GuardrailsSettingsStore = ReturnType<typeof createGuardrailsSettings>;

/** localStorage-based GuardrailsStorage adapter. Gracefully ignored where localStorage is absent. */
export function localStorageGuardrailsStorage(key = "yui.guardrails"): GuardrailsStorage {
  return localStorageStore<RateLimitOverrides>(key);
}
