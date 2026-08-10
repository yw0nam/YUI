import type { ClientContext } from "../contract";
import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

export const CONTEXT_HISTORY_CAP = 20;

export interface ContextHistoryEntry {
  ts: number;
  event_name: string;
  trigger_kind: ClientContext["trigger"]["kind"];
  client_context: ClientContext;
}

export type ContextHistoryStorage = PersistedStorage<ContextHistoryEntry[]>;

function clone(entries: ContextHistoryEntry[]): ContextHistoryEntry[] {
  return structuredClone(entries);
}

function isEntry(value: unknown): value is ContextHistoryEntry {
  if (value === null || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.ts === "number" &&
    typeof entry.event_name === "string" &&
    typeof entry.trigger_kind === "string" &&
    entry.client_context !== null &&
    typeof entry.client_context === "object"
  );
}

function parse(value: unknown): ContextHistoryEntry[] | null {
  if (!Array.isArray(value) || !value.every(isEntry)) return null;
  return clone(value.slice(-CONTEXT_HISTORY_CAP));
}

export function createContextHistory(opts?: { storage?: ContextHistoryStorage }) {
  const core = createPersistedStore<ContextHistoryEntry[]>({
    storage: opts?.storage,
    defaults: [],
    parse,
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    clone,
  });

  return {
    get: core.get,

    append(entry: ContextHistoryEntry): void {
      core.commit([...core.current(), clone([entry])[0]!].slice(-CONTEXT_HISTORY_CAP));
    },

    clear(): void {
      core.commit([]);
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

export function localStorageContextHistory(key = "yui.context-history"): ContextHistoryStorage {
  return localStorageStore<ContextHistoryEntry[]>(key);
}
