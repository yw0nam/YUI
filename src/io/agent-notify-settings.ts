/**
 * AgentNotify feature settings — enabled flag + listener port.
 * Changes persist to storage and notify subscribers reactively.
 */

import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

export interface AgentNotifySettings {
  enabled: boolean;
}

export type AgentNotifyStorage = PersistedStorage<AgentNotifySettings>;

const DEFAULT_SETTINGS: AgentNotifySettings = { enabled: false };

function isValidSettings(v: unknown): v is AgentNotifySettings {
  if (v === null || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return typeof s.enabled === "boolean";
}

export function createAgentNotifySettings(opts?: {
  storage?: AgentNotifyStorage;
  initial?: AgentNotifySettings;
}) {
  const core = createPersistedStore<AgentNotifySettings>({
    storage: opts?.storage,
    initial: opts?.initial,
    defaults: { ...DEFAULT_SETTINGS },
    parse: (v) => (isValidSettings(v) ? { enabled: v.enabled } : null),
    equals: (a, b) => a.enabled === b.enabled,
  });

  return {
    get: core.get,

    setEnabled(enabled: boolean): void {
      core.commit({ ...core.current(), enabled });
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

/** localStorage-backed AgentNotifyStorage adapter. Gracefully no-ops where localStorage is absent. */
export function localStorageAgentNotifyStorage(key = "yui.agentNotify"): AgentNotifyStorage {
  return localStorageStore<AgentNotifySettings>(key);
}
