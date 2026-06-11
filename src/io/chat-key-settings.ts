/**
 * chat API 키 오버라이드를 관리하는 reactive 설정 스토어.
 * 변경 시 storage에 persist하고 구독자에게 통지한다. 빈 문자열 = 오버라이드 없음.
 * 값은 시크릿이다 — 절대 로깅하지 않는다.
 */

/** 비정상적으로 긴 입력 방어용 상한. 실제 키보다 넉넉하게 잡는다. */
export const CHAT_KEY_MAX_LEN = 4096;

export interface ChatKeySettings {
  apiKey: string; // "" => 오버라이드 없음 (SecretProvider가 fallback으로 폴백)
}

export interface ChatKeyStorage {
  load(): ChatKeySettings | null;
  save(s: ChatKeySettings): void;
}

function coerceApiKey(v: unknown): string {
  if (typeof v !== "string") return "";
  const trimmed = v.trim();
  return trimmed.length > CHAT_KEY_MAX_LEN ? trimmed.slice(0, CHAT_KEY_MAX_LEN) : trimmed;
}

function isValidSettings(v: unknown): v is ChatKeySettings {
  if (v === null || typeof v !== "object") return false;
  return typeof (v as Record<string, unknown>).apiKey === "string";
}

export function createChatKeySettings(opts?: {
  storage?: ChatKeyStorage;
  initial?: ChatKeySettings;
}) {
  const storage = opts?.storage;

  let stored: ChatKeySettings | null = null;
  if (storage) {
    try {
      const loaded = storage.load();
      if (isValidSettings(loaded)) stored = { apiKey: coerceApiKey(loaded.apiKey) };
    } catch {
      // storage 오류 시 오버라이드 없음으로 폴백
    }
  }

  // 우선순위: 저장값 > initial > 기본값(빈 문자열)
  let state: ChatKeySettings = stored
    ? { ...stored }
    : opts?.initial
      ? { apiKey: coerceApiKey(opts.initial.apiKey) }
      : { apiKey: "" };

  const subscribers = new Set<(s: ChatKeySettings) => void>();

  function notify(): void {
    const copy = { apiKey: state.apiKey };
    for (const cb of subscribers) cb(copy);
  }

  function commit(next: string): void {
    if (state.apiKey === next) return;
    state = { apiKey: next };
    try {
      storage?.save({ ...state });
    } catch {
      // storage 사용 불가 시 in-memory 상태는 유지
    }
    notify();
  }

  return {
    get(): ChatKeySettings {
      return { apiKey: state.apiKey };
    },

    setApiKey(v: string): void {
      if (typeof v !== "string") return;
      commit(coerceApiKey(v));
    },

    clear(): void {
      commit("");
    },

    // 다른 창이 storage를 갱신했을 때 재로드 — 값이 실제로 바뀌었을 때만 통지.
    reloadFromStorage(): void {
      if (!storage) return;
      let loaded: ChatKeySettings | null;
      try {
        loaded = storage.load();
      } catch {
        return;
      }
      if (!isValidSettings(loaded)) return;
      const next = coerceApiKey(loaded.apiKey);
      if (state.apiKey === next) return;
      state = { apiKey: next };
      notify();
    },

    subscribe(cb: (s: ChatKeySettings) => void): () => void {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },

    dispose(): void {
      subscribers.clear();
    },
  };
}

/** chat-key 스토어 인스턴스 타입 (SecretProvider 주입용). */
export type ChatKeySettingsStore = ReturnType<typeof createChatKeySettings>;

/** localStorage 기반 ChatKeyStorage 어댑터. localStorage 미사용 환경에서 gracefully 무시. */
export function localStorageChatKeyStorage(key = "yui.chat-key"): ChatKeyStorage {
  return {
    load() {
      try {
        const raw = globalThis.localStorage?.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw) as ChatKeySettings;
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
