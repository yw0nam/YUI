/**
 * Reactive localStorage store holding the single last OpenAI Responses response.id.
 * Used as previous_response_id to continue a conversation, and persists across app restarts.
 * Empty means a new conversation (get() returns null). Persists to storage and notifies
 * subscribers only on change.
 */

import { createPersistedStore, type PersistedStorage } from "../../../settings/persisted-store";
import type { ToolOutputItem } from "../stream/chat-client";

export interface SessionStorage {
  load(): string | null;
  /** Outputs for the stored response's unanswered tool calls. */
  loadOutputs(): ToolOutputItem[];
  save(id: string, outputs?: ToolOutputItem[]): void;
  clear(): void;
}

/** Boxed so "no session" stays a value the store holds, notifies, and reloads. */
interface SessionState {
  id: string | null;
  outputs: ToolOutputItem[];
}

/** Only a non-empty string counts as a valid response id. Anything else (non-string/blank) is "none". */
function coerce(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/** Boxes a SessionStorage for the shared core; saving "none" removes the key. */
function boxed(storage: SessionStorage): PersistedStorage<SessionState> {
  return {
    load: () => ({ id: storage.load(), outputs: storage.loadOutputs() }),
    save: (s) => (s.id === null ? storage.clear() : storage.save(s.id, s.outputs)),
  };
}

/** Only well-formed function_call_output items survive a load. */
function coerceOutputs(v: unknown): ToolOutputItem[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (o): o is ToolOutputItem =>
      o?.type === "function_call_output" &&
      typeof o.call_id === "string" &&
      typeof o.output === "string",
  );
}

export function createSessionStore(storage?: SessionStorage) {
  const core = createPersistedStore<SessionState>({
    storage: storage && boxed(storage),
    defaults: { id: null, outputs: [] },
    parse: (v) => ({
      id: coerce((v as SessionState | null)?.id),
      outputs: coerceOutputs((v as SessionState | null)?.outputs),
    }),
    equals: (a, b) => a.id === b.id && JSON.stringify(a.outputs) === JSON.stringify(b.outputs),
  });

  return {
    get(): string | null {
      return core.current().id;
    },

    /** Outputs the stored response's unanswered tool calls need on the next turn. */
    outputs(): ToolOutputItem[] {
      return core.current().outputs;
    },

    set(id: string, outputs: ToolOutputItem[] = []): void {
      const next = coerce(id);
      if (next === null) return;
      core.commit({ id: next, outputs });
    },

    clear(): void {
      core.commit({ id: null, outputs: [] });
    },

    reloadFromStorage: core.reloadFromStorage,

    subscribe(cb: (id: string | null) => void): () => void {
      return core.subscribe((s) => cb(s.id));
    },

    dispose: core.dispose,
  };
}

/** localStorage-backed SessionStorage adapter. Gracefully ignored where localStorage is unavailable. */
export function localStorageSessionStorage(key = "yui.previous_response_id"): SessionStorage {
  const outputsKey = `${key}.tool_outputs`;
  return {
    loadOutputs() {
      try {
        const raw = globalThis.localStorage?.getItem(outputsKey);
        return raw ? coerceOutputs(JSON.parse(raw)) : [];
      } catch {
        return [];
      }
    },
    load() {
      try {
        return globalThis.localStorage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    save(id, outputs = []) {
      try {
        globalThis.localStorage?.setItem(key, id);
        if (outputs.length) globalThis.localStorage?.setItem(outputsKey, JSON.stringify(outputs));
        else globalThis.localStorage?.removeItem(outputsKey);
      } catch {
        // no-op when localStorage is unavailable
      }
    },
    clear() {
      try {
        globalThis.localStorage?.removeItem(key);
        globalThis.localStorage?.removeItem(outputsKey);
      } catch {
        // no-op when localStorage is unavailable
      }
    },
  };
}
