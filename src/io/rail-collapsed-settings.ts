/**
 * Reactive store for the collapsed state (boolean) of the Quick-controls section rail.
 * Persists to storage on change and notifies subscribers.
 */

import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

export type RailCollapsedStorage = PersistedStorage<boolean>;

export function createRailCollapsedSettings(opts?: {
  storage?: RailCollapsedStorage;
  initial?: boolean;
}) {
  const core = createPersistedStore<boolean>({
    storage: opts?.storage,
    initial: opts?.initial,
    defaults: false,
    parse: (v) => (typeof v === "boolean" ? v : null),
    equals: (a, b) => a === b,
    clone: (v) => v,
    fromInitial: (v) => v,
  });

  return {
    get: core.get,

    setCollapsed(collapsed: boolean): void {
      core.commit(collapsed);
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

export type RailCollapsedSettingsStore = ReturnType<typeof createRailCollapsedSettings>;

/** localStorage-backed adapter. Gracefully ignored where localStorage is unavailable. */
export function localStorageRailCollapsedStorage(
  key = "yui.quickControls.railCollapsed",
): RailCollapsedStorage {
  return localStorageStore<boolean>(key);
}
