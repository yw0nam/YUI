/**
 * Shared core for the reactive settings-store family.
 *
 * Each per-store file (vad/lipsync/camera/…) keeps only its type, constants,
 * clamp/coerce, and thin typed setters; the bootstrap/notify/reload/subscribe/
 * dispose machinery and the localStorage adapter live here.
 *
 * Bootstrap priority: stored > initial > defaults. A storage failure falls back
 * to the next priority. `parse` validates+sanitizes a raw loaded value (or
 * returns null to reject it); `migrate` is consulted at bootstrap only.
 */

export interface PersistedStorage<T> {
  load(): T | null;
  save(s: T): void;
}

/** localStorage-backed adapter. Gracefully no-ops where localStorage is absent. */
export function localStorageStore<T>(key: string): PersistedStorage<T> {
  return {
    load() {
      try {
        const raw = globalThis.localStorage?.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    },
    save(s) {
      try {
        globalThis.localStorage?.setItem(key, JSON.stringify(s));
      } catch {
        // No-op when localStorage is unavailable
      }
    },
  };
}

interface PersistedStoreConfig<T> {
  storage?: PersistedStorage<T>;
  initial?: T;
  defaults: T;
  /** Validate+sanitize a raw loaded value; return null to reject it. */
  parse: (loaded: unknown) => T | null;
  /** Change detection — true ⇒ no notify/persist. */
  equals: (a: T, b: T) => boolean;
  /** Deep/shallow copy used for get()/notify()/save(). Default: shallow spread. */
  clone?: (v: T) => T;
  /** Transform a caller-supplied initial value. Default: clone. */
  fromInitial?: (v: T) => T;
  /** Bootstrap-only fallback when parse() rejects the stored value. */
  migrate?: (loaded: unknown) => T | null;
}

export interface PersistedStore<T> {
  /** Current value as an isolated copy. */
  get(): T;
  /** Current raw state — for setters to compute the next value. Do not mutate. */
  current(): T;
  /** Adopt `next` if changed: equals-check → persist → notify. */
  commit(next: T): void;
  /** Re-read storage; adopt+notify when changed. Does not re-persist. */
  reloadFromStorage(): void;
  subscribe(cb: (s: T) => void): () => void;
  dispose(): void;
}

export function createPersistedStore<T>(cfg: PersistedStoreConfig<T>): PersistedStore<T> {
  const { storage, defaults, parse, equals, migrate } = cfg;
  const clone = cfg.clone ?? ((v: T) => ({ ...v }));
  const fromInitial = cfg.fromInitial ?? clone;

  let stored: T | null = null;
  if (storage) {
    try {
      const loaded = storage.load();
      stored = parse(loaded) ?? (migrate ? migrate(loaded) : null);
    } catch {
      // On storage error, fall back to the next priority
    }
  }

  // Priority: stored value > initial > defaults
  let state: T = stored
    ? clone(stored)
    : cfg.initial !== undefined
      ? fromInitial(cfg.initial)
      : clone(defaults);

  const subscribers = new Set<(s: T) => void>();

  function notify(): void {
    const copy = clone(state);
    for (const cb of subscribers) cb(copy);
  }

  return {
    get(): T {
      return clone(state);
    },

    current(): T {
      return state;
    },

    commit(next: T): void {
      if (equals(state, next)) return;
      state = next;
      try {
        storage?.save(clone(state));
      } catch {
        // Keep in-memory state when storage is unavailable
      }
      notify();
    },

    // Reload when another window updates storage — notify only when the value actually changed.
    reloadFromStorage(): void {
      if (!storage) return;
      let loaded: T | null;
      try {
        loaded = storage.load();
      } catch {
        return;
      }
      const next = parse(loaded);
      if (next === null) return;
      if (equals(state, next)) return;
      state = clone(next);
      notify();
    },

    subscribe(cb: (s: T) => void): () => void {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },

    dispose(): void {
      subscribers.clear();
    },
  };
}

/** Boolean on/off settings store: value shape { enabled: boolean }. */
export function createFlagSettings(
  defaultEnabled: boolean,
  opts?: {
    storage?: PersistedStorage<{ enabled: boolean }>;
    initial?: { enabled: boolean };
  },
) {
  const core = createPersistedStore({
    storage: opts?.storage,
    initial: opts?.initial,
    defaults: { enabled: defaultEnabled },
    parse: (v) =>
      v !== null &&
      typeof v === "object" &&
      typeof (v as { enabled?: unknown }).enabled === "boolean"
        ? { enabled: (v as { enabled: boolean }).enabled }
        : null,
    equals: (a, b) => a.enabled === b.enabled,
  });

  return {
    get: core.get,
    setEnabled: (enabled: boolean) => core.commit({ enabled }),
    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

export type FlagSettingsStore = ReturnType<typeof createFlagSettings>;

/** Clamped-integer settings store: value shape { value: number }. */
export function createClampedIntSettings(
  cfg: { default: number; floor: number; ceil: number },
  opts?: { storage?: PersistedStorage<{ value: number }>; initial?: { value: number } },
) {
  const valid = (v: unknown): v is number =>
    typeof v === "number" && Number.isInteger(v) && v >= cfg.floor && v <= cfg.ceil;
  const core = createPersistedStore({
    storage: opts?.storage,
    initial: opts?.initial,
    defaults: { value: cfg.default },
    parse: (v) => {
      const value = v !== null && typeof v === "object" ? (v as { value?: unknown }).value : null;
      return valid(value) ? { value } : null;
    },
    equals: (a, b) => a.value === b.value,
  });

  return {
    get: core.get,
    set(value: number): void {
      if (valid(value)) core.commit({ value });
    },
    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

export type ClampedIntSettingsStore = ReturnType<typeof createClampedIntSettings>;
