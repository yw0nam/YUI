/**
 * AgentNotify feature settings — enabled flag + listener port.
 * Changes persist to storage and notify subscribers reactively.
 */

import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

export interface AgentNotifySettings {
  enabled: boolean;
  port: number;
}

export type AgentNotifyStorage = PersistedStorage<AgentNotifySettings>;

const DEFAULT_SETTINGS: AgentNotifySettings = { enabled: false, port: 8770 };

function isValidPort(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1024 && v <= 65535;
}

function isValidSettings(v: unknown): v is AgentNotifySettings {
  if (v === null || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return typeof s.enabled === "boolean" && isValidPort(s.port);
}

export function createAgentNotifySettings(opts?: {
  storage?: AgentNotifyStorage;
  initial?: AgentNotifySettings;
}) {
  const core = createPersistedStore<AgentNotifySettings>({
    storage: opts?.storage,
    initial: opts?.initial,
    defaults: { ...DEFAULT_SETTINGS },
    parse: (v) => (isValidSettings(v) ? { enabled: v.enabled, port: v.port } : null),
    equals: (a, b) => a.enabled === b.enabled && a.port === b.port,
  });

  return {
    get: core.get,

    setEnabled(enabled: boolean): void {
      core.commit({ ...core.current(), enabled });
    },

    setPort(port: number): void {
      if (!isValidPort(port)) return;
      core.commit({ ...core.current(), port });
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
