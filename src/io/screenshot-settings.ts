/**
 * 스크린샷 기능의 활성화 여부와 소스를 관리하는 reactive 설정 스토어.
 * 변경 시 storage에 persist하고 구독자에게 통지한다.
 */

import type { ScreenSource } from "../contract";

export interface ScreenshotSettings {
  enabled: boolean;
  source: ScreenSource;
}

export interface ScreenshotStorage {
  load(): ScreenshotSettings | null;
  save(s: ScreenshotSettings): void;
}

const DEFAULT_SETTINGS: ScreenshotSettings = {
  enabled: false,
  source: { kind: "monitor", index: 0 },
};

function isValidSettings(v: unknown): v is ScreenshotSettings {
  if (v === null || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  if (typeof s.enabled !== "boolean") return false;
  if (s.source === null || typeof s.source !== "object") return false;
  return true;
}

export function createScreenshotSettings(opts?: {
  storage?: ScreenshotStorage;
  initial?: ScreenshotSettings;
}) {
  const storage = opts?.storage;

  let stored: ScreenshotSettings | null = null;
  if (storage) {
    try {
      const loaded = storage.load();
      if (isValidSettings(loaded)) stored = loaded;
    } catch {
      // storage 오류 시 기본값으로 폴백
    }
  }

  // 우선순위: 저장값 > initial > 기본값
  let state: ScreenshotSettings = stored
    ? { ...stored }
    : opts?.initial
      ? { ...opts.initial }
      : { ...DEFAULT_SETTINGS };

  const subscribers = new Set<(s: ScreenshotSettings) => void>();

  function notify(): void {
    const copy = { ...state };
    for (const cb of subscribers) cb(copy);
  }

  return {
    get(): ScreenshotSettings {
      return { ...state };
    },

    setEnabled(enabled: boolean): void {
      if (state.enabled === enabled) return;
      state = { ...state, enabled };
      storage?.save({ ...state });
      notify();
    },

    setSource(source: ScreenSource): void {
      if (JSON.stringify(state.source) === JSON.stringify(source)) return;
      state = { ...state, source };
      storage?.save({ ...state });
      notify();
    },

    subscribe(cb: (s: ScreenshotSettings) => void): () => void {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },

    dispose(): void {
      subscribers.clear();
    },
  };
}

/** localStorage 기반 ScreenshotStorage 어댑터. localStorage 미사용 환경에서 gracefully 무시. */
export function localStorageScreenshotStorage(key = "yui.screenshot"): ScreenshotStorage {
  return {
    load() {
      try {
        const raw = globalThis.localStorage?.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw) as ScreenshotSettings;
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
