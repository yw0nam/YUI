/**
 * Reactive localStorage store holding the single last OpenAI Responses response.id.
 * Used as previous_response_id to continue a conversation, and persists across app restarts.
 * Empty means a new conversation (get() returns null). Persists to storage and notifies
 * subscribers only on change.
 */

export interface SessionStorage {
  load(): string | null;
  save(id: string): void;
  clear(): void;
}

/** Only a non-empty string counts as a valid response id. Anything else (non-string/blank) is "none". */
function coerce(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export function createSessionStore(storage?: SessionStorage) {
  let state: string | null = null;
  if (storage) {
    try {
      state = coerce(storage.load());
    } catch {
      // On storage error, fall back to "none".
    }
  }

  const subscribers = new Set<(id: string | null) => void>();

  function notify(): void {
    for (const cb of subscribers) cb(state);
  }

  return {
    get(): string | null {
      return state;
    },

    set(id: string): void {
      const next = coerce(id);
      if (next === null || next === state) return;
      state = next;
      storage?.save(state);
      notify();
    },

    clear(): void {
      if (state === null) return;
      state = null;
      storage?.clear();
      notify();
    },

    reloadFromStorage(): void {
      if (!storage) return;
      let loaded: string | null;
      try {
        loaded = coerce(storage.load());
      } catch {
        return;
      }
      if (loaded === state) return;
      state = loaded;
      notify();
    },

    subscribe(cb: (id: string | null) => void): () => void {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },

    dispose(): void {
      subscribers.clear();
    },
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
