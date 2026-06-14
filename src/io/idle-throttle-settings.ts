/**
 * 유휴 절전(30fps 캡) on/off를 관리하는 reactive 설정 스토어.
 * 변경 시 storage에 persist하고 구독자에게 통지한다.
 */

export interface IdleThrottleSettings {
  enabled: boolean;
}

export interface IdleThrottleStorage {
  load(): IdleThrottleSettings | null;
  save(s: IdleThrottleSettings): void;
}

const DEFAULT_SETTINGS: IdleThrottleSettings = {
  enabled: true,
};

function isValidSettings(v: unknown): v is IdleThrottleSettings {
  if (v === null || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return typeof s.enabled === "boolean";
}

export function createIdleThrottleSettings(opts?: {
  storage?: IdleThrottleStorage;
  initial?: IdleThrottleSettings;
}) {
  const storage = opts?.storage;

  let stored: IdleThrottleSettings | null = null;
  if (storage) {
    try {
      const loaded = storage.load();
      if (isValidSettings(loaded)) stored = loaded;
    } catch {
      // storage 오류 시 기본값으로 폴백
    }
  }

  // 우선순위: 저장값 > initial > 기본값
  let state: IdleThrottleSettings = stored
    ? { ...stored }
    : opts?.initial
      ? { ...opts.initial }
      : { ...DEFAULT_SETTINGS };

  const subscribers = new Set<(s: IdleThrottleSettings) => void>();

  function notify(): void {
    const copy = { ...state };
    for (const cb of subscribers) cb(copy);
  }

  return {
    get(): IdleThrottleSettings {
      return { ...state };
    },

    setEnabled(enabled: boolean): void {
      if (state.enabled === enabled) return;
      state = { ...state, enabled };
      storage?.save({ ...state });
      notify();
    },

    // 다른 창이 storage를 갱신했을 때 재로드 — 값이 실제로 바뀌었을 때만 통지.
    reloadFromStorage(): void {
      if (!storage) return;
      let loaded: IdleThrottleSettings | null;
      try {
        loaded = storage.load();
      } catch {
        return;
      }
      if (!isValidSettings(loaded)) return;
      if (loaded.enabled === state.enabled) return;
      state = { ...loaded };
      notify();
    },

    subscribe(cb: (s: IdleThrottleSettings) => void): () => void {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },

    dispose(): void {
      subscribers.clear();
    },
  };
}

/** localStorage 기반 IdleThrottleStorage 어댑터. localStorage 미사용 환경에서 gracefully 무시. */
export function localStorageIdleThrottleStorage(key = "yui.idle-throttle"): IdleThrottleStorage {
  return {
    load() {
      try {
        const raw = globalThis.localStorage?.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw) as IdleThrottleSettings;
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
