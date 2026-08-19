/**
 * Reactive settings store managing the user-editable screen-watch thresholds.
 * 0 means "no override" — the threshold falls back to the bundled configs/screen.json default.
 * Persists to storage on change and notifies subscribers. Never mutates the checked-in config.
 */

import type { ScreenConfig } from "../config/load";
import {
  createPersistedStore,
  isPlainObject,
  localStorageStore,
  type PersistedStorage,
} from "./persisted-store";

/** Largest threshold accepted (24 h) — a stored value above it counts as no override. */
export const SCREEN_MS_MAX = 86_400_000;

/** Editable screen-watch thresholds, in milliseconds. 0 = no override. */
export type ScreenOverrides = { [K in keyof ScreenConfig]: number };

export const SCREEN_KEYS = [
  "prev_dwell_ms",
  "settle_ms",
  "long_session_ms",
  "min_gap_ms",
  "quiet_after_turn_ms",
  "recent_cap",
] as const satisfies readonly (keyof ScreenOverrides)[];

/**
 * Compile-time totality guard: a threshold added to ScreenConfig without a matching key above
 * stops `_MissingScreenKeys` from being `never`, so `pnpm build` catches the gap rather than the
 * threshold silently losing its merge branch, its setter, and its UI knob.
 */
type _MissingScreenKeys = Exclude<keyof ScreenOverrides, (typeof SCREEN_KEYS)[number]>;
const _totalityGuard: _MissingScreenKeys extends never ? true : _MissingScreenKeys = true;
void _totalityGuard;

export type ScreenKnobStorage = PersistedStorage<ScreenOverrides>;

const EMPTY: ScreenOverrides = {
  prev_dwell_ms: 0,
  settle_ms: 0,
  long_session_ms: 0,
  min_gap_ms: 0,
  quiet_after_turn_ms: 0,
  recent_cap: 0,
};

/** A settable threshold: 0 (clear the override) or an integer in 1..SCREEN_MS_MAX. */
function isThreshold(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= SCREEN_MS_MAX;
}

/** Storage sanitation — a stored threshold outside 1..SCREEN_MS_MAX counts as no override. */
function coerceThreshold(v: unknown): number {
  return isThreshold(v) ? v : 0;
}

function coerce(v: unknown): ScreenOverrides {
  const s = (v ?? {}) as Record<string, unknown>;
  const out = { ...EMPTY };
  for (const k of SCREEN_KEYS) out[k] = coerceThreshold(s[k]);
  return out;
}

function equals(a: ScreenOverrides, b: ScreenOverrides): boolean {
  return SCREEN_KEYS.every((k) => a[k] === b[k]);
}

/**
 * Builds a new ScreenConfig by layering the edited thresholds onto the bundled one (base unchanged).
 * A threshold of 0 keeps the config default.
 */
export function mergeScreen(base: ScreenConfig, ov: ScreenOverrides): ScreenConfig {
  const out = { ...base };
  for (const key of SCREEN_KEYS) {
    if (ov[key] > 0) out[key] = ov[key];
  }
  return out;
}

/** Projects a bundled ScreenConfig onto the ScreenOverrides shape for the UI's fallback display. */
export function screenDefaultsFromConfig(s: ScreenConfig): ScreenOverrides {
  const out = { ...EMPTY };
  for (const key of SCREEN_KEYS) out[key] = s[key];
  return out;
}

export function createScreenKnobSettings(opts?: {
  storage?: ScreenKnobStorage;
  initial?: ScreenOverrides;
}) {
  const core = createPersistedStore<ScreenOverrides>({
    storage: opts?.storage,
    initial: opts?.initial,
    defaults: { ...EMPTY },
    // A non-object is rejected so a corrupted stored value cannot erase in-memory/initial thresholds.
    parse: (v) => (isPlainObject(v) ? coerce(v) : null),
    fromInitial: coerce,
    equals,
  });

  return {
    get: core.get,

    /** An out-of-range value is ignored, so a typo never silently drops the threshold already set. */
    set(partial: Partial<ScreenOverrides>): void {
      const next = { ...core.current() };
      for (const k of SCREEN_KEYS) {
        const v = partial[k];
        if (k in partial && isThreshold(v)) next[k] = v;
      }
      core.commit(next);
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

export type ScreenKnobSettingsStore = ReturnType<typeof createScreenKnobSettings>;

/** localStorage-based ScreenKnobStorage adapter. Gracefully ignored where localStorage is absent. */
export function localStorageScreenKnobStorage(key = "yui.screen-knobs"): ScreenKnobStorage {
  return localStorageStore<ScreenOverrides>(key);
}
