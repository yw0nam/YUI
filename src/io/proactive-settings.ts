/**
 * proactive 발화(cowork 등 tier2 소스)의 on/off를 관리하는 reactive 설정 스토어. (#24 Step 8)
 * 변경 시 storage에 persist하고 구독자에게 통지한다. 소스 구독은 멈추지 않고 firing만 게이팅한다.
 */

export interface ProactiveSettings {
  enabled: boolean;
}

export interface ProactiveStorage {
  load(): ProactiveSettings | null;
  save(s: ProactiveSettings): void;
}

const DEFAULT_SETTINGS: ProactiveSettings = {
  enabled: true,
};

function isValidSettings(v: unknown): v is ProactiveSettings {
  if (v === null || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return typeof s.enabled === "boolean";
}

export function createProactiveSettings(opts?: {
  storage?: ProactiveStorage;
  initial?: ProactiveSettings;
}) {
  const storage = opts?.storage;

  let stored: ProactiveSettings | null = null;
  if (storage) {
    try {
      const loaded = storage.load();
      if (isValidSettings(loaded)) stored = loaded;
    } catch {
      // storage 오류 시 기본값으로 폴백
    }
  }

  // 우선순위: 저장값 > initial > 기본값
  let state: ProactiveSettings = stored
    ? { ...stored }
    : opts?.initial
      ? { ...opts.initial }
      : { ...DEFAULT_SETTINGS };

  const subscribers = new Set<(s: ProactiveSettings) => void>();

  function notify(): void {
    const copy = { ...state };
    for (const cb of subscribers) cb(copy);
  }

  return {
    get(): ProactiveSettings {
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
      let loaded: ProactiveSettings | null;
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

    subscribe(cb: (s: ProactiveSettings) => void): () => void {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },

    dispose(): void {
      subscribers.clear();
    },
  };
}

/** localStorage 기반 ProactiveStorage 어댑터. localStorage 미사용 환경에서 gracefully 무시. */
export function localStorageProactiveStorage(key = "yui.proactive"): ProactiveStorage {
  return {
    load() {
      try {
        const raw = globalThis.localStorage?.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw) as ProactiveSettings;
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
