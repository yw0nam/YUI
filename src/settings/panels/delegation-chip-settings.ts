/**
 * delegation-chip-settings — whether the delegation chip shows only its dot and count badge.
 *
 * The fold is a per-device choice: it persists across relaunches on this device alone and is
 * never synced cross-window.
 */

import { createPersistedStore, localStorageStore, type PersistedStorage } from "../persisted-store";

export interface DelegationChipSettings {
  collapsed: boolean;
}

export type DelegationChipStorage = PersistedStorage<DelegationChipSettings>;

function isValidSettings(v: unknown): v is DelegationChipSettings {
  return (
    v !== null &&
    typeof v === "object" &&
    typeof (v as Record<string, unknown>).collapsed === "boolean"
  );
}

export function createDelegationChipSettings(opts?: { storage?: DelegationChipStorage }) {
  const core = createPersistedStore<DelegationChipSettings>({
    storage: opts?.storage,
    defaults: { collapsed: false },
    parse: (v) => (isValidSettings(v) ? { collapsed: v.collapsed } : null),
    equals: (a, b) => a.collapsed === b.collapsed,
  });

  return {
    get: core.get,

    setCollapsed(collapsed: boolean): void {
      core.commit({ collapsed });
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

export type DelegationChipSettingsStore = ReturnType<typeof createDelegationChipSettings>;

/** localStorage-backed DelegationChipStorage adapter. Gracefully ignored where localStorage is unavailable. */
export function localStorageDelegationChipStorage(
  key = "yui.delegation-chip",
): DelegationChipStorage {
  return localStorageStore<DelegationChipSettings>(key);
}
