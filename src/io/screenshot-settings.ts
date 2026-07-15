/**
 * Reactive settings store that manages screenshot feature enabled state and source.
 * Persists to storage and notifies subscribers on change.
 */

import type { ScreenSource } from "../contract";
import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

export interface ScreenshotSettings {
  enabled: boolean;
  source: ScreenSource;
}

export type ScreenshotStorage = PersistedStorage<ScreenshotSettings>;

const DEFAULT_SETTINGS: ScreenshotSettings = {
  enabled: false,
  source: { kind: "monitor", index: 0 },
};

function isValidSettings(v: unknown): v is ScreenshotSettings {
  if (v === null || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  if (typeof s.enabled !== "boolean") return false;
  if (s.source === null || typeof s.source !== "object") return false;
  return true;
}

export function createScreenshotSettings(opts?: {
  storage?: ScreenshotStorage;
  initial?: ScreenshotSettings;
}) {
  const core = createPersistedStore<ScreenshotSettings>({
    storage: opts?.storage,
    initial: opts?.initial,
    defaults: { ...DEFAULT_SETTINGS },
    parse: (v) => (isValidSettings(v) ? v : null),
    equals: (a, b) =>
      a.enabled === b.enabled && JSON.stringify(a.source) === JSON.stringify(b.source),
  });

  return {
    get: core.get,

    setEnabled(enabled: boolean): void {
      core.commit({ ...core.current(), enabled });
    },

    setSource(source: ScreenSource): void {
      core.commit({ ...core.current(), source });
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

/** localStorage-based ScreenshotStorage adapter; gracefully ignored when localStorage is unavailable. */
export function localStorageScreenshotStorage(key = "yui.screenshot"): ScreenshotStorage {
  return localStorageStore<ScreenshotSettings>(key);
}
