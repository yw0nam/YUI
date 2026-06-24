/**
 * 카메라 줌 + 궤도(orbit) 시점을 관리하는 reactive 설정 스토어.
 * 변경 시 storage에 persist하고 구독자에게 통지한다. zoom > 1 ⇒ 캐릭터가 더 크게 보임
 * (fit 거리를 줌으로 나눠 카메라가 가까워진다 — 적용은 renderer.fitCamera).
 * azimuth/polar(라디안)은 fit 시점을 구 위에서 회전시킨다(적용은 renderer.setOrbit).
 */

import { CAMERA_AZIMUTH_DEFAULT, CAMERA_POLAR_DEFAULT, clampPolar } from "../renderer/camera-fit";
import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

export const CAMERA_ZOOM_MIN = 0.5;
export const CAMERA_ZOOM_MAX = 3.0;
export const CAMERA_ZOOM_DEFAULT = 1.0;
/** 휠 1틱당 줌 변화 민감도 (nextZoom의 exp 지수 계수). */
export const CAMERA_WHEEL_SENSITIVITY = 0.0015;
/** Alt+드래그 1px당 orbit 각도 변화(라디안). ~200px 드래그 ≈ 57°. */
export const CAMERA_ORBIT_SENSITIVITY = 0.005;

export interface CameraSettings {
  zoom: number;
  /** Orbit azimuth around +Y (radians). free — wrapped to (-π, π]. */
  azimuth: number;
  /** Orbit polar from +Y (radians). clamped to the free range [2°, 178°]. */
  polar: number;
}

export type CameraStorage = PersistedStorage<CameraSettings>;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function clampZoom(zoom: number): number {
  return Math.min(CAMERA_ZOOM_MAX, Math.max(CAMERA_ZOOM_MIN, zoom));
}

/** Wrap any angle into (-π, π] — keeps a free azimuth bounded across repeated nudges. */
function wrapAzimuth(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * Parse + sanitize a persisted blob. zoom is required; legacy blobs without orbit
 * angles fill the head-on defaults (backward compat). Out-of-range values are clamped.
 */
function parse(v: unknown): CameraSettings | null {
  if (v === null || typeof v !== "object") return null;
  const s = v as Record<string, unknown>;
  if (!isFiniteNumber(s.zoom)) return null;
  return {
    zoom: clampZoom(s.zoom),
    azimuth: isFiniteNumber(s.azimuth) ? wrapAzimuth(s.azimuth) : CAMERA_AZIMUTH_DEFAULT,
    polar: isFiniteNumber(s.polar) ? clampPolar(s.polar, false) : CAMERA_POLAR_DEFAULT,
  };
}

export function createCameraSettings(opts?: { storage?: CameraStorage; initial?: CameraSettings }) {
  const core = createPersistedStore<CameraSettings>({
    storage: opts?.storage,
    initial: opts?.initial,
    defaults: {
      zoom: CAMERA_ZOOM_DEFAULT,
      azimuth: CAMERA_AZIMUTH_DEFAULT,
      polar: CAMERA_POLAR_DEFAULT,
    },
    parse,
    equals: (a, b) => a.zoom === b.zoom && a.azimuth === b.azimuth && a.polar === b.polar,
  });

  return {
    get: core.get,

    setZoom(zoom: number): void {
      if (!Number.isFinite(zoom)) return;
      core.commit({ ...core.get(), zoom: clampZoom(zoom) });
    },

    /** Set the orbit azimuth (radians). free — wrapped to (-π, π]. */
    setAzimuth(azimuth: number): void {
      if (!Number.isFinite(azimuth)) return;
      core.commit({ ...core.get(), azimuth: wrapAzimuth(azimuth) });
    },

    /** Set the orbit polar (radians). clamped to the free range [2°, 178°]. */
    setPolar(polar: number): void {
      if (!Number.isFinite(polar)) return;
      core.commit({ ...core.get(), polar: clampPolar(polar, false) });
    },

    /** Reset only the orbit angles to head-on; leaves zoom unchanged. */
    resetOrbit(): void {
      core.commit({
        ...core.get(),
        azimuth: CAMERA_AZIMUTH_DEFAULT,
        polar: CAMERA_POLAR_DEFAULT,
      });
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
