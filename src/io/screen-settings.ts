/**
 * Reactive settings store managing the user-editable screen-watch knobs.
 * 0 means "no override" — the knob falls back to the bundled configs/screen.json default.
 * Persists to storage on change and notifies subscribers. Never mutates the checked-in config.
 */

import type { ScreenConfig } from "../config/load";
import {
  applyPositiveOverrides,
  createOverrideRecordSettings,
  localStorageStore,
  type PersistedStorage,
  projectOverrides,
} from "./persisted-store";

/** Largest ms threshold accepted (24 h) — a stored value above it counts as no override. */
export const SCREEN_MS_MAX = 86_400_000;

/** Largest recent_cap accepted — matches the UI row's upper bound (SCREEN_KNOB_FIELDS). */
export const SCREEN_RECENT_CAP_MAX = 20;

/** Editable screen-watch knobs — five ms thresholds plus the unitless recent_cap count. 0 = no override. */
export type ScreenOverrides = { [K in keyof ScreenConfig]: number };

export type ScreenKnobStorage = PersistedStorage<ScreenOverrides>;

/**
 * No override for any knob. Its keys are the store's key list, so a threshold added to ScreenConfig
 * without an entry here (and in SCREEN_KEY_MAX) fails to typecheck rather than silently losing its
 * merge branch, its setter, and its UI knob.
 */
const EMPTY: ScreenOverrides = {
  prev_dwell_ms: 0,
  settle_ms: 0,
  long_session_ms: 0,
  min_gap_ms: 0,
  quiet_after_turn_ms: 0,
  recent_cap: 0,
};

const KEYS = Object.keys(EMPTY) as (keyof ScreenOverrides)[];

/** Per-key ceiling for a settable value — ms thresholds cap at SCREEN_MS_MAX, recent_cap at SCREEN_RECENT_CAP_MAX. */
const SCREEN_KEY_MAX: Record<keyof ScreenOverrides, number> = {
  prev_dwell_ms: SCREEN_MS_MAX,
  settle_ms: SCREEN_MS_MAX,
  long_session_ms: SCREEN_MS_MAX,
  min_gap_ms: SCREEN_MS_MAX,
  quiet_after_turn_ms: SCREEN_MS_MAX,
  recent_cap: SCREEN_RECENT_CAP_MAX,
};

/** A settable value for `key`: 0 (clear the override) or an integer within its own ceiling. */
function acceptThreshold(key: keyof ScreenOverrides, v: unknown): number | undefined {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= SCREEN_KEY_MAX[key]
    ? v
    : undefined;
}

/**
 * Builds a new ScreenConfig by layering the edited thresholds onto the bundled one (base unchanged).
 * A threshold of 0 keeps the config default.
 */
export function mergeScreen(base: ScreenConfig, ov: ScreenOverrides): ScreenConfig {
  return applyPositiveOverrides(base, ov, KEYS);
}

/** Projects a bundled ScreenConfig onto the ScreenOverrides shape for the UI's fallback display. */
export function screenDefaultsFromConfig(s: ScreenConfig): ScreenOverrides {
  return projectOverrides(EMPTY, (key) => s[key]);
}

export function createScreenKnobSettings(opts?: { storage?: ScreenKnobStorage }) {
  return createOverrideRecordSettings<ScreenOverrides>({
    storage: opts?.storage,
    empty: EMPTY,
    accept: acceptThreshold,
  });
}

export type ScreenKnobSettingsStore = ReturnType<typeof createScreenKnobSettings>;

/** localStorage-based ScreenKnobStorage adapter. Gracefully ignored where localStorage is absent. */
export function localStorageScreenKnobStorage(key = "yui.screen-knobs"): ScreenKnobStorage {
  return localStorageStore<ScreenOverrides>(key);
}
