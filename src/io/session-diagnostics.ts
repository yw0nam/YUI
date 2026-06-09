/**
 * Reactive store for the Settings-window session diagnostics (used tokens / context window / last
 * compression). localStorage is the cross-window seam — a separate window reads the same key. Notify
 * only on actual change; coerce stored junk to defaults. The `at` timestamp is supplied by the caller
 * so the store stays pure and testable.
 */

export interface LastCompressionEntry {
  beforeTokens: number;
  afterTokens: number;
  removed: number;
  /** ISO timestamp, supplied by the caller. */
  at: string;
}

export interface SessionDiagnostics {
  usedTokens: number | null;
  contextWindow: number | null;
  lastCompression: LastCompressionEntry | null;
}

export interface SessionDiagnosticsStorage {
  load(): SessionDiagnostics | null;
  save(s: SessionDiagnostics): void;
}

const DEFAULTS: SessionDiagnostics = {
  usedTokens: null,
  contextWindow: null,
  lastCompression: null,
};

function coerceNumberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function coerceLastCompression(v: unknown): LastCompressionEntry | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (
    typeof o.beforeTokens !== "number" ||
    typeof o.afterTokens !== "number" ||
    typeof o.removed !== "number" ||
    typeof o.at !== "string"
  ) {
    return null;
  }
  return {
    beforeTokens: o.beforeTokens,
    afterTokens: o.afterTokens,
    removed: o.removed,
    at: o.at,
  };
}

function coerce(v: unknown): SessionDiagnostics {
  const o = (v ?? {}) as Record<string, unknown>;
  return {
    usedTokens: coerceNumberOrNull(o.usedTokens),
    contextWindow: coerceNumberOrNull(o.contextWindow),
    lastCompression: coerceLastCompression(o.lastCompression),
  };
}

function lastCompressionEquals(
  a: LastCompressionEntry | null,
  b: LastCompressionEntry | null,
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.beforeTokens === b.beforeTokens &&
    a.afterTokens === b.afterTokens &&
    a.removed === b.removed &&
    a.at === b.at
  );
}

function equals(a: SessionDiagnostics, b: SessionDiagnostics): boolean {
  return (
    a.usedTokens === b.usedTokens &&
    a.contextWindow === b.contextWindow &&
    lastCompressionEquals(a.lastCompression, b.lastCompression)
  );
}

function clone(s: SessionDiagnostics): SessionDiagnostics {
  return {
    usedTokens: s.usedTokens,
    contextWindow: s.contextWindow,
    lastCompression: s.lastCompression ? { ...s.lastCompression } : null,
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

    setLastCompression(entry: LastCompressionEntry): void {
      const next = clone(state);
      next.lastCompression = { ...entry };
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
