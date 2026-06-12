/**
 * 카메라 줌 배율을 관리하는 reactive 설정 스토어.
 * 변경 시 storage에 persist하고 구독자에게 통지한다. zoom > 1 ⇒ 캐릭터가 더 크게 보임
 * (fit 거리를 줌으로 나눠 카메라가 가까워진다 — 적용은 renderer.fitCamera).
 */

export const CAMERA_ZOOM_MIN = 0.5;
export const CAMERA_ZOOM_MAX = 3.0;
export const CAMERA_ZOOM_DEFAULT = 1.0;
/** 휠 1틱당 줌 변화 민감도 (nextZoom의 exp 지수 계수). */
export const CAMERA_WHEEL_SENSITIVITY = 0.0015;

export interface CameraSettings {
  zoom: number;
}

export interface CameraStorage {
  load(): CameraSettings | null;
  save(s: CameraSettings): void;
}

function isValidSettings(v: unknown): v is CameraSettings {
  if (v === null || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return typeof s.zoom === "number" && Number.isFinite(s.zoom);
}

function clampZoom(zoom: number): number {
  return Math.min(CAMERA_ZOOM_MAX, Math.max(CAMERA_ZOOM_MIN, zoom));
}

export function createCameraSettings(opts?: { storage?: CameraStorage; initial?: CameraSettings }) {
  const storage = opts?.storage;

  let stored: CameraSettings | null = null;
  if (storage) {
    try {
      const loaded = storage.load();
      if (isValidSettings(loaded)) stored = { zoom: clampZoom(loaded.zoom) };
    } catch {
      // storage 오류 시 기본값으로 폴백
    }
  }

  // 우선순위: 저장값 > initial > 기본값
  let state: CameraSettings = stored
    ? { ...stored }
    : opts?.initial
      ? { ...opts.initial }
      : { zoom: CAMERA_ZOOM_DEFAULT };

  const subscribers = new Set<(s: CameraSettings) => void>();

  function notify(): void {
    const copy = { zoom: state.zoom };
    for (const cb of subscribers) cb(copy);
  }

  return {
    get(): CameraSettings {
      return { zoom: state.zoom };
    },

    setZoom(zoom: number): void {
      if (!Number.isFinite(zoom)) return;
      const clamped = clampZoom(zoom);
      if (state.zoom === clamped) return;
      state = { zoom: clamped };
      storage?.save({ ...state });
      notify();
    },

    // 다른 창이 storage를 갱신했을 때 재로드 — 값이 실제로 바뀌었을 때만 통지.
    reloadFromStorage(): void {
      if (!storage) return;
      let loaded: CameraSettings | null;
      try {
        loaded = storage.load();
      } catch {
        return;
      }
      if (!isValidSettings(loaded)) return;
      const next = clampZoom(loaded.zoom);
      if (state.zoom === next) return;
      state = { zoom: next };
      notify();
    },

    subscribe(cb: (s: CameraSettings) => void): () => void {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },

    dispose(): void {
      subscribers.clear();
    },
  };
}

/** localStorage 기반 CameraStorage 어댑터. localStorage 미사용 환경에서 gracefully 무시. */
export function localStorageCameraStorage(key = "yui.camera"): CameraStorage {
  return {
    load() {
      try {
        const raw = globalThis.localStorage?.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw) as CameraSettings;
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
