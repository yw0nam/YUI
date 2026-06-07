/**
 * 립싱크 게인을 관리하는 reactive 설정 스토어.
 * 변경 시 storage에 persist하고 구독자에게 통지한다.
 */

export const LIPSYNC_GAIN_MIN = 0.5;
export const LIPSYNC_GAIN_MAX = 4.0;
export const LIPSYNC_GAIN_DEFAULT = 2.0;

export interface LipsyncSettings {
  gain: number;
}

export interface LipsyncStorage {
  load(): LipsyncSettings | null;
  save(s: LipsyncSettings): void;
}

function isValidSettings(v: unknown): v is LipsyncSettings {
  if (v === null || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return typeof s.gain === "number" && Number.isFinite(s.gain);
}

function clampGain(gain: number): number {
  return Math.min(LIPSYNC_GAIN_MAX, Math.max(LIPSYNC_GAIN_MIN, gain));
}

export function createLipsyncSettings(opts?: {
  storage?: LipsyncStorage;
  initial?: LipsyncSettings;
}) {
  const storage = opts?.storage;

  let stored: LipsyncSettings | null = null;
  if (storage) {
    try {
      const loaded = storage.load();
      if (isValidSettings(loaded)) stored = { gain: clampGain(loaded.gain) };
    } catch {
      // storage 오류 시 기본값으로 폴백
    }
  }

  // 우선순위: 저장값 > initial > 기본값
  let state: LipsyncSettings = stored
    ? { ...stored }
    : opts?.initial
      ? { ...opts.initial }
      : { gain: LIPSYNC_GAIN_DEFAULT };

  const subscribers = new Set<(s: LipsyncSettings) => void>();

  function notify(): void {
    const copy = { gain: state.gain };
    for (const cb of subscribers) cb(copy);
  }

  return {
    get(): LipsyncSettings {
      return { gain: state.gain };
    },

    setGain(gain: number): void {
      if (!Number.isFinite(gain)) return;
      const clamped = clampGain(gain);
      if (state.gain === clamped) return;
      state = { gain: clamped };
      storage?.save({ ...state });
      notify();
    },

    subscribe(cb: (s: LipsyncSettings) => void): () => void {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },

    dispose(): void {
      subscribers.clear();
    },
  };
}

/** localStorage 기반 LipsyncStorage 어댑터. localStorage 미사용 환경에서 gracefully 무시. */
export function localStorageLipsyncStorage(key = "yui.lipsync"): LipsyncStorage {
  return {
    load() {
      try {
        const raw = globalThis.localStorage?.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw) as LipsyncSettings;
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
