/**
 * Shared core for the reactive settings-store family.
 *
 * Each per-store file (vad/lipsync/camera/…) keeps only its type, constants,
 * clamp/coerce, and thin typed setters; the bootstrap/notify/reload/subscribe/
 * dispose machinery and the localStorage adapter live here.
 *
 * Bootstrap priority: stored > defaults. A storage failure falls back to the
 * defaults. `parse` validates+sanitizes a raw loaded value, returning null to
 * reject it.
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

/** True for a loaded value that could plausibly hold a settings shape's fields — not null, not an array. */
export function isPlainObject(v: unknown): boolean {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

interface PersistedStoreConfig<T> {
  storage?: PersistedStorage<T>;
  defaults: T;
  /** Validate+sanitize a raw loaded value; return null to reject it. */
  parse: (loaded: unknown) => T | null;
  /** Change detection — true ⇒ no notify/persist. */
  equals: (a: T, b: T) => boolean;
  /** Deep/shallow copy used for get()/notify()/save(). Default: shallow spread. */
  clone?: (v: T) => T;
}

interface PersistedStore<T> {
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
  const { storage, defaults, parse, equals } = cfg;
  const clone = cfg.clone ?? ((v: T) => ({ ...v }));

  let stored: T | null = null;
  if (storage) {
    try {
      stored = parse(storage.load());
    } catch {
      // On storage error, fall back to the defaults
    }
  }

  // Priority: stored value > defaults
  let state: T = stored ? clone(stored) : clone(defaults);

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
  opts?: { storage?: PersistedStorage<{ enabled: boolean }> },
) {
  const core = createPersistedStore({
    storage: opts?.storage,
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
  opts?: { storage?: PersistedStorage<{ value: number }> },
) {
  const valid = (v: unknown): v is number =>
    typeof v === "number" && Number.isInteger(v) && v >= cfg.floor && v <= cfg.ceil;
  const core = createPersistedStore({
    storage: opts?.storage,
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

/** Constraint for an override record: every field is a scalar, so `===` decides change. */
type ScalarFields<T> = { [K in keyof T]: string | number };

interface OverrideRecordConfig<T extends ScalarFields<T>> {
  storage?: PersistedStorage<T>;
  /** The no-override value for every key — its keys are the store's key list. */
  empty: T;
  /** Validate one key's incoming value: the value to adopt, or undefined to keep the current one. */
  accept: <K extends keyof T>(key: K, v: unknown) => T[K] | undefined;
}

/**
 * Overridable-record settings store: a flat record of per-key overrides layered onto a bundled
 * config. A stored value `accept` rejects sanitizes to the empty value; a value handed to set()
 * that it rejects is ignored, so a typo never silently drops the override already set.
 */
export function createOverrideRecordSettings<T extends ScalarFields<T>>(
  cfg: OverrideRecordConfig<T>,
) {
  const keys = Object.keys(cfg.empty) as (keyof T)[];
  const empty = (): T => ({ ...cfg.empty });

  const core = createPersistedStore<T>({
    storage: cfg.storage,
    defaults: empty(),
    // A non-object is rejected so a corrupted stored value cannot erase in-memory overrides.
    parse: (v) => {
      if (!isPlainObject(v)) return null;
      const raw = v as Record<string, unknown>;
      const out = empty();
      for (const k of keys) out[k] = cfg.accept(k, raw[k as string]) ?? cfg.empty[k];
      return out;
    },
    equals: (a, b) => keys.every((k) => a[k] === b[k]),
  });

  return {
    get: core.get,

    set(partial: Partial<T>): void {
      const next = { ...core.current() };
      for (const k of keys) {
        if (!(k in partial)) continue;
        const v = cfg.accept(k, partial[k]);
        if (v !== undefined) next[k] = v;
      }
      core.commit(next);
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

/**
 * Layers the positive values of `ov` onto a copy of `base`; 0 keeps base's value. Only `keys` are
 * read, so an unexpected key in a stored override never reaches the merged config.
 */
export function applyPositiveOverrides<B extends ScalarFields<B>>(
  base: B,
  ov: Partial<B>,
  keys: readonly (keyof B)[],
): B {
  const out = { ...base };
  for (const k of keys) {
    const v = ov[k];
    if (typeof v === "number" && v > 0) out[k] = v as B[keyof B];
  }
  return out;
}

/** Projects a bundled config onto an override shape, reading one value per key of `empty`. */
export function projectOverrides<T extends ScalarFields<T>>(
  empty: T,
  read: (key: keyof T) => T[keyof T],
): T {
  const out = { ...empty };
  for (const k of Object.keys(empty) as (keyof T)[]) out[k] = read(k);
  return out;
}
