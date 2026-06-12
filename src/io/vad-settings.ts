/**
 * VAD 침묵 기준(silence window)을 관리하는 reactive 설정 스토어.
 * 변경 시 storage에 persist하고 구독자에게 통지한다.
 */

export const VAD_SILENCE_MIN = 500;
export const VAD_SILENCE_MAX = 3000;
export const VAD_SILENCE_DEFAULT = 1500;

export interface VadSettings {
  silenceMs: number;
}

export interface VadStorage {
  load(): VadSettings | null;
  save(s: VadSettings): void;
}

function isValidSettings(v: unknown): v is VadSettings {
  if (v === null || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return typeof s.silenceMs === "number" && Number.isFinite(s.silenceMs);
}

function clampSilence(ms: number): number {
  return Math.min(VAD_SILENCE_MAX, Math.max(VAD_SILENCE_MIN, ms));
}

export function createVadSettings(opts?: { storage?: VadStorage; initial?: VadSettings }) {
  const storage = opts?.storage;

  let stored: VadSettings | null = null;
  if (storage) {
    try {
      const loaded = storage.load();
      if (isValidSettings(loaded)) stored = { silenceMs: clampSilence(loaded.silenceMs) };
    } catch {
      // storage 오류 시 기본값으로 폴백
    }
  }

  // 우선순위: 저장값 > initial > 기본값
  let state: VadSettings = stored
    ? { ...stored }
    : opts?.initial
      ? { ...opts.initial }
      : { silenceMs: VAD_SILENCE_DEFAULT };

  const subscribers = new Set<(s: VadSettings) => void>();

  function notify(): void {
    const copy = { silenceMs: state.silenceMs };
    for (const cb of subscribers) cb(copy);
  }

  return {
    get(): VadSettings {
      return { silenceMs: state.silenceMs };
    },

    setSilenceMs(ms: number): void {
      if (!Number.isFinite(ms)) return;
      const clamped = clampSilence(ms);
      if (state.silenceMs === clamped) return;
      state = { silenceMs: clamped };
      storage?.save({ ...state });
      notify();
    },

    // 다른 창이 storage를 갱신했을 때 재로드 — 값이 실제로 바뀌었을 때만 통지.
    reloadFromStorage(): void {
      if (!storage) return;
      let loaded: VadSettings | null;
      try {
        loaded = storage.load();
      } catch {
        return;
      }
      if (!isValidSettings(loaded)) return;
      const next = clampSilence(loaded.silenceMs);
      if (state.silenceMs === next) return;
      state = { silenceMs: next };
      notify();
    },

    subscribe(cb: (s: VadSettings) => void): () => void {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },

    dispose(): void {
      subscribers.clear();
    },
  };
}

/** localStorage 기반 VadStorage 어댑터. localStorage 미사용 환경에서 gracefully 무시. */
export function localStorageVadStorage(key = "yui.vad"): VadStorage {
  return {
    load() {
      try {
        const raw = globalThis.localStorage?.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw) as VadSettings;
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
