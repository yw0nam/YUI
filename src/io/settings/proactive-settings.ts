/**
 * Reactive settings store managing on/off plus the entry list of idle-gap-based proactive cues (quick break/gentle check, etc.).
 * Persists to storage on change and notifies subscribers. Does not stop source subscriptions; only gates firing.
 */

import {
  type Cue,
  type CueListSettings,
  type CueLocale,
  type CueStorage,
  createCueListSettings,
} from "./cue-list-settings";
import { localStorageStore } from "./persisted-store";
import { PROACTIVE_CUE_SEEDS } from "./proactive-seeds";

export interface ProactiveCue extends Cue {
  /** Minutes elapsed since the last interaction. */
  idle_min: number;
}

export type ProactiveSettings = CueListSettings<ProactiveCue>;

export type ProactiveStorage = CueStorage<ProactiveCue>;

function isValidIdleMin(v: unknown): boolean {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

export function defaultSettings(locale: CueLocale): ProactiveSettings {
  return { enabled: true, entries: structuredClone(PROACTIVE_CUE_SEEDS[locale]) };
}

export function createProactiveSettings(opts?: { storage?: ProactiveStorage; locale?: CueLocale }) {
  return createCueListSettings<ProactiveCue>({
    storage: opts?.storage,
    defaults: defaultSettings(opts?.locale ?? "ko"),
    extras: { idle_min: { blank: 10, isValid: isValidIdleMin } },
  });
}

/** localStorage-backed ProactiveStorage adapter. Gracefully ignored where localStorage is unavailable. */
export function localStorageProactiveStorage(key = "yui.proactive"): ProactiveStorage {
  return localStorageStore<ProactiveSettings>(key);
}
