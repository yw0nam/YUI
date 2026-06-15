/**
 * 마지막 OpenAI Responses response.id 하나를 보관하는 reactive localStorage 스토어.
 * previous_response_id로 대화를 잇는 데 쓰이며 앱 재시작 간에도 유지된다. 비어있으면
 * 새 대화다(get()이 null 반환). 변경 시에만 storage에 persist하고 구독자에게 통지한다.
 */

export interface SessionStorage {
  load(): string | null;
  save(id: string): void;
  clear(): void;
}

/** 비어있지 않은 문자열만 유효한 response id로 본다. 그 외(non-string·공백)는 "없음". */
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

/** localStorage 기반 SessionStorage 어댑터. localStorage 미사용 환경에서 gracefully 무시. */
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
