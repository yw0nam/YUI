/**
 * Reactive settings store for the launch bed scene: on/off and the wake timeout in seconds.
 * On change, persists to storage and notifies subscribers.
 */

import { createPersistedStore, type PersistedStorage } from "../persisted-store";

export const WAKE_TIMEOUT_MIN_S = 10;
export const WAKE_TIMEOUT_MAX_S = 3600;
export const WAKE_TIMEOUT_DEFAULT_S = 120;

export const BED_SCENE_STORAGE_KEY = "yui.bed-scene";

export interface BedSceneSettings {
  enabled: boolean;
  wakeTimeoutS: number;
}

export type BedSceneStorage = PersistedStorage<BedSceneSettings>;

function isValidSettings(v: unknown): v is BedSceneSettings {
  if (v === null || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  if (typeof s.enabled !== "boolean") return false;
  return typeof s.wakeTimeoutS === "number" && Number.isFinite(s.wakeTimeoutS);
}

function clampTimeoutS(s: number): number {
  return Math.min(WAKE_TIMEOUT_MAX_S, Math.max(WAKE_TIMEOUT_MIN_S, Math.round(s)));
}

export function createBedSceneSettings(opts?: { storage?: BedSceneStorage }) {
  const core = createPersistedStore<BedSceneSettings>({
    storage: opts?.storage,
    defaults: { enabled: true, wakeTimeoutS: WAKE_TIMEOUT_DEFAULT_S },
    parse: (v) =>
      isValidSettings(v)
        ? { enabled: v.enabled, wakeTimeoutS: clampTimeoutS(v.wakeTimeoutS) }
        : null,
    equals: (a, b) => a.enabled === b.enabled && a.wakeTimeoutS === b.wakeTimeoutS,
  });

  return {
    get: core.get,

    setEnabled(enabled: boolean): void {
      core.commit({ ...core.get(), enabled });
    },

    setWakeTimeoutS(s: number): void {
      if (!Number.isFinite(s)) return;
      core.commit({ ...core.get(), wakeTimeoutS: clampTimeoutS(s) });
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

export type BedSceneSettingsStore = ReturnType<typeof createBedSceneSettings>;
