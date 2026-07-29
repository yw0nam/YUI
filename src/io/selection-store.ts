/**
 * Generic reactive selection store shared by VRM and speaker selection.
 * Owns the currently selected option: holds the state, persists an override id,
 * and resolves the active option. It does not perform any renderer/registry work.
 */

/** The override is the stored id string, or null (no override). */
export interface SelectionOverrideStorage {
  load(): string | null;
  save(id: string | null): void;
}

/** Persistence adapter for the list of imported source:"user" options. */
export interface UserOptionStorage<T> {
  load(): T[];
  save(list: T[]): void;
}

/** Minimal shape a domain's option type must satisfy. */
interface SelectionOption {
  id: string;
  label?: string;
  source?: string;
}

/** Coerce an override candidate into a safe shape (non-empty string or null). */
function coerceOverride(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function createSelectionStore<T extends SelectionOption>(opts: {
  available?: T[];
  defaultValue: string;
  storage?: SelectionOverrideStorage;
  userStorage?: UserOptionStorage<T>;
  /** Synthesizes a single-entry manifest from defaultValue, used when `available` is empty. */
  synthesize: (defaultValue: string) => T;
  /** Coerces a single imported option into a safe source:"user" T (null if incomplete). */
  coerceUser: (v: unknown) => T | null;
  /** Whether an option matches the manifest default (resolve()'s second-priority match). */
  isDefault: (option: T, defaultValue: string) => boolean;
}) {
  const { storage, userStorage, synthesize, coerceUser, isDefault } = opts;

  // The manifest (options + defaultValue) is mutable since setManifest can update it.
  // When available is missing or empty, synthesize a single entry from fallback — UNLESS fallback
  // is also empty, in which case there is genuinely nothing to synthesize from and list() is empty
  // (e.g. a server-listed voice domain with zero registered voices and no configured default).
  function normalize(available: T[] | undefined, fallback: string): T[] {
    if (available && available.length > 0) return available.map((o) => ({ ...o }));
    return fallback.length > 0 ? [synthesize(fallback)] : [];
  }

  let defaultValue = opts.defaultValue;
  let bundled: T[] = normalize(opts.available, defaultValue);

  // Imported user options — discard entries colliding with bundled ids (bundled wins).
  function isBundledId(id: string): boolean {
    return bundled.some((o) => o.id === id);
  }
  let userOptions: T[] = [];

  // Union-merge userStorage list into in-memory userOptions — discard bundled id collisions,
  // dedupe by id (reloaded entries win). Prevents lost updates from other windows.
  function mergeUserOptions(): void {
    if (!userStorage) return;
    let persisted: T[];
    try {
      persisted = userStorage.load();
    } catch {
      return; // Preserve existing user options on storage error
    }
    for (const raw of persisted) {
      const opt = coerceUser(raw);
      if (!opt || isBundledId(opt.id)) continue;
      const idx = userOptions.findIndex((u) => u.id === opt.id);
      if (idx >= 0) userOptions[idx] = opt;
      else userOptions.push(opt);
    }
  }
  mergeUserOptions();

  // Full list of candidates to resolve: user entries after bundled (no duplicate ids).
  function options(): T[] {
    return [...bundled, ...userOptions];
  }

  function hasId(id: string): boolean {
    return options().some((o) => o.id === id);
  }

  // Load stored override, treat stale/removed ids as absent.
  let override: string | null = null;
  if (storage) {
    try {
      const loaded = coerceOverride(storage.load());
      if (loaded !== null) override = loaded;
    } catch {
      // Fall back to no override on storage error
    }
  }

  // Resolution priority: (1) override (present in list) > (2) default match > (3) list[0] >
  // (4) a transient synthesize(defaultValue) when options() is genuinely empty (nothing to select —
  // never persisted into bundled/userOptions, so list() stays empty; callers see a stable T instead
  // of dereferencing an empty array).
  function resolve(): T {
    const all = options();
    if (override !== null) {
      const o = all.find((x) => x.id === override);
      if (o) return o;
    }
    const defaultMatch = all.find((x) => isDefault(x, defaultValue));
    if (defaultMatch) return defaultMatch;
    return all.length > 0 ? all[0] : synthesize(defaultValue);
  }

  const subscribers = new Set<(active: T) => void>();

  function notify(): void {
    const copy = { ...resolve() };
    for (const cb of subscribers) cb(copy);
  }

  function persistUser(): void {
    userStorage?.save(userOptions.map((o) => ({ ...o })));
  }

  return {
    list(): T[] {
      return options().map((o) => ({ ...o }));
    },

    /** All options bundled ∪ user (dedup, bundled wins). Same result as list(). */
    getOptions(): T[] {
      return options().map((o) => ({ ...o }));
    },

    /** Add/update imported user option. Reject bundled id collisions; force source to "user". */
    addUserOption(opt: T): void {
      if (isBundledId(opt.id)) return; // bundled always wins
      const next = { ...opt, source: "user" } as T;
      const idx = userOptions.findIndex((o) => o.id === next.id);
      if (idx >= 0) userOptions[idx] = next;
      else userOptions.push(next);
      persistUser();
    },

    /** Remove user option. If currently selected, fall back to default resolution + notify. */
    removeUserOption(id: string): void {
      const idx = userOptions.findIndex((o) => o.id === id);
      if (idx < 0) return;
      const wasActive = resolve().id === id;
      userOptions.splice(idx, 1);
      persistUser();
      if (!wasActive) return;
      override = null;
      storage?.save(null);
      notify();
    },

    /** Update user option label + persist + notify (if active). Unknown/bundled id or empty label is no-op. */
    renameUserOption(id: string, label: string): void {
      const trimmed = label.trim();
      if (trimmed.length === 0) return;
      const opt = userOptions.find((o) => o.id === id);
      if (!opt || opt.label === trimmed) return;
      opt.label = trimmed;
      persistUser();
      if (resolve().id === id) notify();
    },

    getActive(): T {
      return { ...resolve() };
    },

    getActiveId(): string {
      return resolve().id;
    },

    select(id: string): void {
      if (!hasId(id)) return; // Unknown id — prevent garbage persist
      if (resolve().id === id) return; // No-op if already active
      override = id;
      storage?.save(id);
      notify();
    },

    reset(): void {
      if (override === null) return;
      override = null;
      storage?.save(null);
      notify();
    },

    // Config hot-reload: replace manifest + default. Preserve user override, but
    // fall back to default resolution if absent in new manifest. Notify only if active id actually changes.
    setManifest(next: { available?: T[]; defaultValue: string }): void {
      const before = resolve().id;
      defaultValue = next.defaultValue;
      bundled = normalize(next.available, defaultValue);
      // Drop user options colliding with new bundled ids (bundled wins).
      userOptions = userOptions.filter((u) => !isBundledId(u.id));
      if (override !== null && !hasId(override)) override = null;
      if (resolve().id === before) return;
      notify();
    },

    // Reload when other window updates storage — re-read both user list and override pointer to
    // prevent cross-window lost update; notify only if resolution actually changed.
    reloadFromStorage(): void {
      const before = resolve().id;
      mergeUserOptions();
      if (storage) {
        let loaded: string | null;
        try {
          loaded = coerceOverride(storage.load());
        } catch {
          loaded = override;
        }
        override = loaded !== null && hasId(loaded) ? loaded : null;
      }
      if (resolve().id === before) return;
      notify();
    },

    subscribe(cb: (active: T) => void): () => void {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },

    dispose(): void {
      subscribers.clear();
    },
  };
}

/** localStorage-based SelectionOverrideStorage adapter; gracefully ignored when localStorage is unavailable. */
export function localStorageOverrideStorage(key: string): SelectionOverrideStorage {
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
        if (id === null) globalThis.localStorage?.removeItem(key);
        else globalThis.localStorage?.setItem(key, id);
      } catch {
        // No-op when localStorage is unavailable
      }
    },
  };
}

/** localStorage-based UserOptionStorage adapter (imported options list as JSON). Malformed/corrupted entries dropped. */
export function localStorageUserOptionStorage<T>(
  key: string,
  coerceUser: (v: unknown) => T | null,
): UserOptionStorage<T> {
  return {
    load() {
      try {
        const raw = globalThis.localStorage?.getItem(key);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.map((v) => coerceUser(v)).filter((o): o is T => o !== null);
      } catch {
        return [];
      }
    },
    save(list) {
      try {
        globalThis.localStorage?.setItem(key, JSON.stringify(list));
      } catch {
        // No-op when localStorage is unavailable
      }
    },
  };
}
