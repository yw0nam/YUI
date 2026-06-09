/**
 * 현재 Hermes 세션 id(UUID) 하나를 보관하는 reactive localStorage 스토어.
 * 앱 재시작 간에도 유지되며, 이 기능 전체가 참조하는 단일 포인터다. 저장값이 없으면
 * 첫 get()에서 새 UUID를 mint·persist한다(첫 턴부터 id 보장). 변경 시에만 storage에
 * persist하고 구독자에게 통지한다.
 */

export interface SessionStorage {
  load(): string | null;
  save(id: string): void;
  clear(): void;
}

/** 비어있지 않은 문자열만 유효한 세션 id로 본다. 그 외(non-string·공백)는 "없음". */
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
      // storage 오류 시 "없음"으로 폴백
    }
  }

  const subscribers = new Set<(id: string | null) => void>();

  function notify(): void {
    for (const cb of subscribers) cb(state);
  }

  return {
    get(): string {
      if (state === null) {
        state = crypto.randomUUID();
        storage?.save(state);
        notify();
      }
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

/** localStorage 기반 SessionStorage 어댑터. localStorage 미사용 환경에서 gracefully 무시. */
export function localStorageSessionStorage(key = "yui.session_id"): SessionStorage {
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
        // localStorage 사용 불가 시 no-op
      }
    },
    clear() {
      try {
        globalThis.localStorage?.removeItem(key);
      } catch {
        // localStorage 사용 불가 시 no-op
      }
    },
  };
}
