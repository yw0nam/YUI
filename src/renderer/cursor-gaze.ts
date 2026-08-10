/**
 * Cursor-gaze head/eye tracking — the stateful three.js apply layer over the
 * pure ./gaze-tracker math.
 *
 * Maps the cursor's screen offset from the head directly to a yaw/pitch residual
 * (VTube-Studio style) rather than unprojecting into a 3D target — a screen-space
 * offset reads as a far smaller angle once actually unprojected through a camera.
 *
 * Owns the damped gaze state, cached head/neck bones, the claimed lookAt, and the
 * per-frame scratch vectors. step() post-multiplies the motion-posed head/neck and
 * sets the eye yaw/pitch each frame; nothing else reads gaze state except the frame
 * gate, which reads isConverging().
 */

import type { VRM } from "@pixiv/three-vrm";
import * as THREE from "three";
import {
  advanceGaze,
  type GazeConfig,
  type GazeState,
  NEUTRAL_GAZE,
  splitHeadNeck,
} from "./gaze-tracker";

const DEG2RAD = Math.PI / 180;

/**
 * Default cursor-gaze tracking — the "natural" preset; overridden by configs/avatar.json `gaze`.
 * disengageDeg sits above MAX_RESIDUAL_DEG so a desktop pet never "gives up" tracking the cursor.
 */
const DEFAULT_GAZE: GazeConfig = {
  deadDeg: 2,
  headEngageDeg: 6,
  disengageDeg: 45,
  sensitivity: 30,
  maxHeadYaw: 50,
  maxHeadPitch: 30,
  eyeMaxDeg: 25,
  headNeckSplit: 0.6,
  smooth: 10,
};

/** Ceiling on the (yaw, pitch) residual vector magnitude — below disengageDeg on purpose. */
const MAX_RESIDUAL_DEG = 40;

/** Merge a partial gaze config over a base, ignoring missing/non-finite keys. */
function mergeGaze(base: GazeConfig, next: Partial<GazeConfig> | undefined): GazeConfig {
  if (!next) return { ...base };
  const out = { ...base };
  for (const k of Object.keys(base) as (keyof GazeConfig)[]) {
    const v = next[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/**
 * Cursor screen-offset → yaw/pitch residual (VTube-Studio style direct mapping). Both axes
 * normalize by the mount WIDTH (one reference length) so equal pixel offsets read as equal
 * angles regardless of aspect ratio. CSS y grows downward; pitch is negated so a cursor above
 * the head reads as positive (look up). The (yaw, pitch) vector is clamped to MAX_RESIDUAL_DEG,
 * scaling both components together so direction is preserved.
 */
export function cursorToResidual(
  cursor: { x: number; y: number },
  headCss: { x: number; y: number },
  mountWidthPx: number,
  sensitivityDeg: number,
): { residualYawDeg: number; residualPitchDeg: number; eccentricityDeg: number } {
  const nx = (cursor.x - headCss.x) / mountWidthPx;
  const ny = (cursor.y - headCss.y) / mountWidthPx;
  let residualYawDeg = nx * sensitivityDeg;
  let residualPitchDeg = -ny * sensitivityDeg;
  const mag = Math.hypot(residualYawDeg, residualPitchDeg);
  if (mag > MAX_RESIDUAL_DEG) {
    const scale = MAX_RESIDUAL_DEG / mag;
    residualYawDeg *= scale;
    residualPitchDeg *= scale;
  }
  return { residualYawDeg, residualPitchDeg, eccentricityDeg: Math.min(mag, MAX_RESIDUAL_DEG) };
}

/** Logger surface the gaze path needs (matches the renderer logger). */
interface GazeLog {
  error(event: string, fields?: Record<string, unknown>): void;
}

interface CursorGazeDeps {
  camera: THREE.Camera;
  /** The live VRM (or undefined) — read fresh each step; never cached across frames. */
  getVrm: () => VRM | undefined;
  /** Initial thresholds; live path is setConfig. Omitted keys keep defaults. */
  gaze?: Partial<GazeConfig>;
  log: GazeLog;
  /** Mount element width (CSS px) — head screen-projection + residual normalization. */
  mountWidth(): number;
  /** Mount element height (CSS px) — head screen-projection. */
  mountHeight(): number;
}

export interface CursorGaze {
  /**
   * One frame of cursor-gaze tracking — call after mixer.update, before vrm.update,
   * so the head/neck nudge rides on the posed skeleton and the eyes compose on it.
   */
  step(dt: number): void;
  /** Cache head/neck bones, reset damped state, claim lookAt for eye control. */
  onVrmLoaded(vrm: VRM): void;
  /** Drop bone/lookAt refs + reset damped state so nothing carries to the next VRM. */
  onVrmDisposed(): void;
  /** True while the damped gaze is still easing toward target — gates the idle frame cap. */
  isConverging(): boolean;
  /** Merge live thresholds over the current config (omitted/non-finite keys kept). */
  setConfig(next: Partial<GazeConfig>): void;
  /** Enable/disable head+eye tracking at runtime. Disabled ⇒ eased back to neutral. */
  setEnabled(enabled: boolean): void;
  /** Latest window-local CSS px cursor position; null = unavailable (eases back to neutral). */
  setCursorCss(pos: { x: number; y: number } | null): void;
}

export function createCursorGaze(deps: CursorGazeDeps): CursorGaze {
  const { camera, getVrm, log, mountWidth, mountHeight } = deps;

  // ── Cursor gaze (head/eye tracking) state ────────────────────────────────────
  // Thresholds: defaults overridden by injected config (and live via setConfig).
  let gazeConfig: GazeConfig = mergeGaze(DEFAULT_GAZE, deps.gaze);
  // Runtime on/off (persisted by main.ts). Disabled ⇒ eased back to neutral, not snapped.
  let gazeEnabled = true;
  // Persistent damped angles (deg) carried frame to frame.
  let gazeState: GazeState = { ...NEUTRAL_GAZE };
  // True while the damped gaze is still easing toward target — gates the idle frame cap.
  let gazeConverging = false;
  // Cached head/neck bones for the per-frame nudge (refreshed on load; no per-frame lookup).
  let gazeHeadBone: THREE.Object3D | null = null;
  let gazeNeckBone: THREE.Object3D | null = null;
  // True once the loaded VRM's lookAt has been claimed (autoUpdate off) for eye control.
  let gazeLookAtReady = false;
  // Latest window-local CSS px cursor position; null = unavailable.
  let gazeCursor: { x: number; y: number } | null = null;
  // Scratch reused every frame for the head's world→screen projection + bone-nudge apply.
  const gazeHeadPos = new THREE.Vector3();
  const gazeDeltaEuler = new THREE.Euler(0, 0, 0, "YXZ");
  const gazeDeltaQuat = new THREE.Quaternion();

  /**
   * One frame of cursor-gaze tracking — called after mixer.update, before vrm.update,
   * so the head/neck nudge rides on the posed skeleton into the humanoid/spring apply
   * and the eyes (driven via lookAt inside vrm.update) compose on the nudged head.
   *
   * Projects the head bone through the camera to its screen position, then maps the
   * cursor's screen offset from it directly to a yaw/pitch residual (see cursorToResidual),
   * damps toward the shaped targets, then post-multiplies the head/neck bones and sets the
   * eye yaw/pitch. Additive over whatever motion is playing. No-op (no bone writes) once
   * settled.
   *
   * ponytail: assumes the playing clip animates head/neck each frame (idle/sit do), so the
   * post-multiply rides a fresh motion pose; a head-trackless clip would let the nudge
   * accumulate.
   */
  function step(dt: number): void {
    const currentVrm = getVrm();
    if (!currentVrm) {
      gazeConverging = false;
      return;
    }
    let residualYawDeg = 0;
    let residualPitchDeg = 0;
    let eccentricityDeg = 0;
    const trackable = gazeEnabled && gazeHeadBone !== null && gazeCursor !== null;
    if (trackable) {
      try {
        const head = gazeHeadBone as THREE.Object3D;
        const cursor = gazeCursor as { x: number; y: number };
        head.getWorldPosition(gazeHeadPos);
        gazeHeadPos.project(camera); // world → NDC, in place
        const headCss = {
          x: (gazeHeadPos.x + 1) * 0.5 * mountWidth(),
          y: (1 - gazeHeadPos.y) * 0.5 * mountHeight(),
        };
        const res = cursorToResidual(cursor, headCss, mountWidth(), gazeConfig.sensitivity);
        residualYawDeg = res.residualYawDeg;
        residualPitchDeg = res.residualPitchDeg;
        eccentricityDeg = res.eccentricityDeg;
      } catch (err) {
        log.error("step_gaze_read", { error: String(err) });
      }
    }

    const adv = advanceGaze(
      gazeState,
      { enabled: trackable, residualYawDeg, residualPitchDeg, eccentricityDeg },
      gazeConfig,
      dt,
    );
    gazeState = adv.state;
    gazeConverging = adv.converging;
    if (!adv.active) return; // settled at neutral — leave the motion/eyes untouched.

    try {
      const hasNeck = gazeNeckBone !== null;
      const yawSplit = splitHeadNeck(gazeState.headYaw, gazeConfig.headNeckSplit, hasNeck);
      const pitchSplit = splitHeadNeck(gazeState.headPitch, gazeConfig.headNeckSplit, hasNeck);
      if (gazeNeckBone) {
        gazeDeltaEuler.set(pitchSplit.neck * DEG2RAD, yawSplit.neck * DEG2RAD, 0, "YXZ");
        gazeNeckBone.quaternion.multiply(gazeDeltaQuat.setFromEuler(gazeDeltaEuler));
      }
      if (gazeHeadBone) {
        gazeDeltaEuler.set(pitchSplit.head * DEG2RAD, yawSplit.head * DEG2RAD, 0, "YXZ");
        gazeHeadBone.quaternion.multiply(gazeDeltaQuat.setFromEuler(gazeDeltaEuler));
      }
      // Eyes — applied inside vrm.update (after the head nudge is copied to raw bones).
      if (gazeLookAtReady && currentVrm.lookAt) {
        currentVrm.lookAt.yaw = gazeState.eyeYaw;
        currentVrm.lookAt.pitch = gazeState.eyePitch;
      }
    } catch (err) {
      log.error("step_gaze_apply", { error: String(err) });
    }
  }

  function onVrmLoaded(vrm: VRM): void {
    // Cache head/neck for the per-frame gaze nudge; claim lookAt for eye control.
    gazeHeadBone = vrm.humanoid?.getNormalizedBoneNode("head") ?? null;
    gazeNeckBone = vrm.humanoid?.getNormalizedBoneNode("neck") ?? null;
    gazeState = { ...NEUTRAL_GAZE };
    gazeConverging = false;
    gazeLookAtReady = vrm.lookAt != null;
    if (vrm.lookAt) vrm.lookAt.autoUpdate = false; // we drive yaw/pitch ourselves each frame.
  }

  function onVrmDisposed(): void {
    // Drop gaze bone refs + reset damped state so nothing carries to the next VRM.
    gazeHeadBone = null;
    gazeNeckBone = null;
    gazeLookAtReady = false;
    gazeState = { ...NEUTRAL_GAZE };
    gazeConverging = false;
  }

  return {
    step,
    onVrmLoaded,
    onVrmDisposed,
    isConverging() {
      return gazeConverging;
    },
    setConfig(next) {
      gazeConfig = mergeGaze(gazeConfig, next);
    },
    setEnabled(enabled) {
      gazeEnabled = enabled;
    },
    setCursorCss(pos) {
      gazeCursor = pos;
    },
  };
}
