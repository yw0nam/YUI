/**
 * Reactive localStorage store holding the single last OpenAI Responses response.id.
 * Used as previous_response_id to continue a conversation, and persists across app restarts.
 * Empty means a new conversation (get() returns null). Persists to storage and notifies
 * subscribers only on change.
 */

import { createPersistedStore, type PersistedStorage } from "./persisted-store";

export interface SessionStorage {
  load(): string | null;
  save(id: string): void;
  clear(): void;
}

/** Boxed so "no session" stays a value the store holds, notifies, and reloads. */
interface SessionState {
  id: string | null;
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
    load: () => ({ id: storage.load() }),
    save: (s) => (s.id === null ? storage.clear() : storage.save(s.id)),
  };
}

export function createSessionStore(storage?: SessionStorage) {
  const core = createPersistedStore<SessionState>({
    storage: storage && boxed(storage),
    defaults: { id: null },
    parse: (v) => ({ id: coerce((v as SessionState | null)?.id) }),
    equals: (a, b) => a.id === b.id,
  });

  return {
    get(): string | null {
      return core.current().id;
    },

    set(id: string): void {
      const next = coerce(id);
      if (next === null) return;
      core.commit({ id: next });
    },

    clear(): void {
      core.commit({ id: null });
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
  return {
    load() {
      try {
        return globalThis.localStorage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    save(id) {
      try {
        globalThis.localStorage?.setItem(key, id);
      } catch {
        // no-op when localStorage is unavailable
      }
    },
    clear() {
      try {
        globalThis.localStorage?.removeItem(key);
      } catch {
        // no-op when localStorage is unavailable
      }
    },
  };
}
