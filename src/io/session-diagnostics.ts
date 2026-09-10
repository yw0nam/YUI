/**
 * Reactive store for the Settings-window session diagnostics (used tokens / context window).
 * localStorage is the cross-window seam — a separate window reads the same key. Notify only on actual
 * change; coerce stored junk to defaults.
 */

import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

export interface SessionDiagnostics {
  usedTokens: number | null;
  contextWindow: number | null;
}

export type SessionDiagnosticsStorage = PersistedStorage<SessionDiagnostics>;

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

export function createSessionDiagnosticsStore(storage?: SessionDiagnosticsStorage) {
  const core = createPersistedStore<SessionDiagnostics>({
    storage,
    defaults: { ...DEFAULTS },
    // An absent stored value leaves the current one alone; anything else coerces, junk included.
    parse: (v) => (v === null ? null : coerce(v)),
    equals: (a, b) => a.usedTokens === b.usedTokens && a.contextWindow === b.contextWindow,
  });

  return {
    get: core.get,

    setUsage(usedTokens: number | null, contextWindow: number | null): void {
      core.commit({ usedTokens, contextWindow });
    },

    clear(): void {
      core.commit({ ...DEFAULTS });
    },

    subscribe: core.subscribe,

    reloadFromStorage: core.reloadFromStorage,

    dispose: core.dispose,
  };
}

/** localStorage-backed SessionDiagnosticsStorage adapter; gracefully no-op when unavailable. */
export function localStorageSessionDiagnosticsStorage(
  key = "yui.session_diagnostics",
): SessionDiagnosticsStorage {
  return localStorageStore<SessionDiagnostics>(key);
}
