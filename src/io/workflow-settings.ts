import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

export interface WorkflowEntry {
  id: string;
  label: string;
  url: string;
}

export interface WorkflowSettings {
  entries: WorkflowEntry[];
}

export type WorkflowStorage = PersistedStorage<WorkflowSettings>;

export function isValidWorkflowUrl(v: string): boolean {
  const value = v.trim();
  if (!value || !/^https?:\/\//i.test(value)) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function isValidEntry(v: unknown): v is WorkflowEntry {
  if (v === null || typeof v !== "object") return false;
  const entry = v as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.label === "string" &&
    typeof entry.url === "string" &&
    isValidWorkflowUrl(entry.url)
  );
}

function isValidSettings(v: unknown): v is WorkflowSettings {
  if (v === null || typeof v !== "object") return false;
  const settings = v as Record<string, unknown>;
  return Array.isArray(settings.entries) && settings.entries.every(isValidEntry);
}

const DEFAULT_SETTINGS: WorkflowSettings = { entries: [] };

export function createWorkflowSettings(opts?: {
  storage?: WorkflowStorage;
  initial?: WorkflowSettings;
}) {
  const core = createPersistedStore<WorkflowSettings>({
    storage: opts?.storage,
    initial: opts?.initial,
    defaults: DEFAULT_SETTINGS,
    parse: (v) => (isValidSettings(v) ? v : null),
    clone: structuredClone,
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });

  const findWorkflow = (id: string): WorkflowEntry | undefined =>
    core.current().entries.find((entry) => entry.id === id);

  return {
    get: core.get,

    addWorkflow(input: { label: string; url: string }): WorkflowEntry | null {
      const label = input.label.trim();
      const url = input.url.trim();
      if (!label || !isValidWorkflowUrl(url)) return null;
      const entry: WorkflowEntry = { id: crypto.randomUUID(), label, url };
      core.commit({ entries: [...core.current().entries, entry] });
      return structuredClone(entry);
    },

    updateWorkflow(id: string, patch: Partial<Omit<WorkflowEntry, "id">>): void {
      const current = findWorkflow(id);
      if (!current) return;
      const next = { ...current };
      let changed = false;

      if (typeof patch.label === "string" && patch.label.trim()) {
        const label = patch.label.trim();
        if (next.label !== label) {
          next.label = label;
          changed = true;
        }
      }
      if (typeof patch.url === "string" && isValidWorkflowUrl(patch.url)) {
        const url = patch.url.trim();
        if (next.url !== url) {
          next.url = url;
          changed = true;
        }
      }

      if (!changed) return;
      core.commit({
        entries: core.current().entries.map((entry) => (entry.id === id ? next : entry)),
      });
    },

    removeWorkflow(id: string): void {
      if (!findWorkflow(id)) return;
      core.commit({ entries: core.current().entries.filter((entry) => entry.id !== id) });
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

export function localStorageWorkflowStorage(key = "yui.workflows"): WorkflowStorage {
  return localStorageStore<WorkflowSettings>(key);
}
