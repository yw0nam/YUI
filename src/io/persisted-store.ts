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
        // localStorage 사용 불가 시 no-op
      }
    },
  };
}

export interface PersistedStoreConfig<T> {
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
      // storage 오류 시 다음 우선순위로 폴백
    }
  }

  // 우선순위: 저장값 > initial > 기본값
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
        // storage 사용 불가 시 in-memory 상태는 유지
      }
      notify();
    },

    // 다른 창이 storage를 갱신했을 때 재로드 — 값이 실제로 바뀌었을 때만 통지.
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
