/**
 * Reactive store for the Settings-window session diagnostics (used tokens / context window).
 * localStorage is the cross-window seam — a separate window reads the same key. Notify only on actual
 * change; coerce stored junk to defaults.
 */

export interface SessionDiagnostics {
  usedTokens: number | null;
  contextWindow: number | null;
}

export interface SessionDiagnosticsStorage {
  load(): SessionDiagnostics | null;
  save(s: SessionDiagnostics): void;
}

const DEFAULTS: SessionDiagnostics = {
  usedTokens: null,
  contextWindow: null,
};

function coerceNumberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function coerce(v: unknown): SessionDiagnostics {
  const o = (v ?? {}) as Record<string, unknown>;
  return {
    usedTokens: coerceNumberOrNull(o.usedTokens),
    contextWindow: coerceNumberOrNull(o.contextWindow),
  };
}

function equals(a: SessionDiagnostics, b: SessionDiagnostics): boolean {
  return a.usedTokens === b.usedTokens && a.contextWindow === b.contextWindow;
}

function clone(s: SessionDiagnostics): SessionDiagnostics {
  return {
    usedTokens: s.usedTokens,
    contextWindow: s.contextWindow,
  };
}

export function createSessionDiagnosticsStore(storage?: SessionDiagnosticsStorage) {
  let state: SessionDiagnostics = { ...DEFAULTS };
  if (storage) {
    try {
      const loaded = storage.load();
      if (loaded !== null) state = coerce(loaded);
    } catch {
      // storage error → defaults
    }
  }

  const subscribers = new Set<(s: SessionDiagnostics) => void>();

  function commit(next: SessionDiagnostics): void {
    if (equals(state, next)) return;
    state = next;
    storage?.save(clone(state));
    notify();
  }

  function notify(): void {
    const copy = clone(state);
    for (const cb of subscribers) cb(copy);
  }

  return {
    get(): SessionDiagnostics {
      return clone(state);
    },

    setUsage(usedTokens: number | null, contextWindow: number | null): void {
      const next = clone(state);
      next.usedTokens = usedTokens;
      next.contextWindow = contextWindow;
      commit(next);
    },

    clear(): void {
      commit({ ...DEFAULTS });
    },

    subscribe(cb: (s: SessionDiagnostics) => void): () => void {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },

    reloadFromStorage(): void {
      if (!storage) return;
      let loaded: SessionDiagnostics | null;
      try {
        loaded = storage.load();
      } catch {
        return;
      }
      if (loaded === null) return;
      const next = coerce(loaded);
      if (equals(state, next)) return;
      state = next;
      notify();
    },

    dispose(): void {
      subscribers.clear();
    },
  };
}

/** localStorage-backed SessionDiagnosticsStorage adapter; gracefully no-op when unavailable. */
export function localStorageSessionDiagnosticsStorage(
  key = "yui.session_diagnostics",
): SessionDiagnosticsStorage {
  return {
    load() {
      try {
        const raw = globalThis.localStorage?.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw) as SessionDiagnostics;
      } catch {
        return null;
      }
    },
    save(s) {
      try {
        globalThis.localStorage?.setItem(key, JSON.stringify(s));
      } catch {
        // localStorage unavailable → no-op
      }
    },
  };
}
