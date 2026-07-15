/**
 * Reactive settings store managing camera zoom + orbit viewpoint.
 * Persists to storage on change and notifies subscribers. zoom > 1 ⇒ the character appears larger
 * (the fit distance is divided by zoom so the camera moves closer — applied in renderer.fitCamera).
 * azimuth/polar (radians) rotate the fit viewpoint over a sphere (applied in renderer.setOrbit).
 */

import { CAMERA_AZIMUTH_DEFAULT, CAMERA_POLAR_DEFAULT, clampPolar } from "../renderer/camera-fit";
import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

export const CAMERA_ZOOM_MIN = 0.5;
export const CAMERA_ZOOM_MAX = 3.0;
export const CAMERA_ZOOM_DEFAULT = 1.0;
/** Zoom-change sensitivity per wheel tick (exp exponent coefficient in nextZoom). */
export const CAMERA_WHEEL_SENSITIVITY = 0.0015;
/** Orbit angle change per 1px of Shift+drag (radians). ~200px drag ≈ 57°. */
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

/** localStorage-based CameraStorage adapter. Gracefully ignored in environments without localStorage. */
export function localStorageCameraStorage(key = "yui.camera"): CameraStorage {
  return localStorageStore<CameraSettings>(key);
}
