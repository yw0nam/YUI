/**
 * Reactive settings store managing on/off plus the entry list of time-based schedule cues (morning/lunch/evening, etc.).
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
import { SCHEDULE_CUE_SEEDS } from "./schedule-seeds";

export interface ScheduledCue extends Cue {
  /** "HH:MM" 24h. */
  time: string;
}

export type ScheduleSettings = CueListSettings<ScheduledCue>;

export type ScheduleStorage = CueStorage<ScheduledCue>;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function defaultSettings(locale: CueLocale): ScheduleSettings {
  return { enabled: true, entries: structuredClone(SCHEDULE_CUE_SEEDS[locale]) };
}

export function createScheduleSettings(opts?: { storage?: ScheduleStorage; locale?: CueLocale }) {
  return createCueListSettings<ScheduledCue>({
    storage: opts?.storage,
    defaults: defaultSettings(opts?.locale ?? "ko"),
    extras: {
      time: { blank: "12:00", isValid: (v) => typeof v === "string" && TIME_RE.test(v) },
    },
  });
}

/** localStorage-backed ScheduleStorage adapter. Gracefully ignored where localStorage is unavailable. */
export function localStorageScheduleStorage(key = "yui.schedule"): ScheduleStorage {
  return localStorageStore<ScheduleSettings>(key);
}
