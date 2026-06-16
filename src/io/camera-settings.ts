/**
 * 카메라 줌 배율을 관리하는 reactive 설정 스토어.
 * 변경 시 storage에 persist하고 구독자에게 통지한다. zoom > 1 ⇒ 캐릭터가 더 크게 보임
 * (fit 거리를 줌으로 나눠 카메라가 가까워진다 — 적용은 renderer.fitCamera).
 */

import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

export const CAMERA_ZOOM_MIN = 0.5;
export const CAMERA_ZOOM_MAX = 3.0;
export const CAMERA_ZOOM_DEFAULT = 1.0;
/** 휠 1틱당 줌 변화 민감도 (nextZoom의 exp 지수 계수). */
export const CAMERA_WHEEL_SENSITIVITY = 0.0015;

export interface CameraSettings {
  zoom: number;
}

export type CameraStorage = PersistedStorage<CameraSettings>;

function isValidSettings(v: unknown): v is CameraSettings {
  if (v === null || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return typeof s.zoom === "number" && Number.isFinite(s.zoom);
}

function clampZoom(zoom: number): number {
  return Math.min(CAMERA_ZOOM_MAX, Math.max(CAMERA_ZOOM_MIN, zoom));
}

export function createCameraSettings(opts?: { storage?: CameraStorage; initial?: CameraSettings }) {
  const core = createPersistedStore<CameraSettings>({
    storage: opts?.storage,
    initial: opts?.initial,
    defaults: { zoom: CAMERA_ZOOM_DEFAULT },
    parse: (v) => (isValidSettings(v) ? { zoom: clampZoom(v.zoom) } : null),
    equals: (a, b) => a.zoom === b.zoom,
  });

  return {
    get: core.get,

    setZoom(zoom: number): void {
      if (!Number.isFinite(zoom)) return;
      core.commit({ zoom: clampZoom(zoom) });
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

/** localStorage 기반 CameraStorage 어댑터. localStorage 미사용 환경에서 gracefully 무시. */
export function localStorageCameraStorage(key = "yui.camera"): CameraStorage {
  return localStorageStore<CameraSettings>(key);
}
