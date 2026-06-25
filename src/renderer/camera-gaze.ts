/**
 * Camera-gaze head/eye tracking — the stateful three.js apply layer over the
 * pure ./gaze-tracker math.
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
const RAD2DEG = 180 / Math.PI;

/** Default camera-gaze tracking — the "natural" preset; overridden by configs/avatar.json `gaze`. */
const DEFAULT_GAZE: GazeConfig = {
  deadDeg: 3,
  headEngageDeg: 20,
  disengageDeg: 65,
  maxHeadYaw: 50,
  maxHeadPitch: 30,
  eyeMaxDeg: 25,
  headNeckSplit: 0.6,
  smooth: 10,
};

/** Clamp to [-1, 1] — guards acos/asin domain against float drift. */
function clampUnit(v: number): number {
  return Math.min(1, Math.max(-1, v));
}

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

/** Logger surface the gaze path needs (matches the renderer logger). */
interface GazeLog {
  error(event: string, fields?: Record<string, unknown>): void;
}

export interface CameraGazeDeps {
  camera: THREE.Camera;
  /** The live VRM (or undefined) — read fresh each step; never cached across frames. */
  getVrm: () => VRM | undefined;
  /** Initial thresholds; live path is setConfig. Omitted keys keep defaults. */
  gaze?: Partial<GazeConfig>;
  log: GazeLog;
}

export interface CameraGaze {
  /**
   * One frame of camera-gaze tracking — call after mixer.update, before vrm.update,
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
  /** Current toggle state (true = tracking the camera). */
  getEnabled(): boolean;
}

export function createCameraGaze(deps: CameraGazeDeps): CameraGaze {
  const { camera, getVrm, log } = deps;

  // ── Camera gaze (head/eye tracking) state ────────────────────────────────────
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
  // Scratch reused every frame — no per-frame allocation in the gaze path.
  const gazeToCam = new THREE.Vector3();
  const gazeBodyFwd = new THREE.Vector3();
  const gazeHeadPos = new THREE.Vector3();
  const gazeHeadQuat = new THREE.Quaternion();
  const gazeHeadQuatInv = new THREE.Quaternion();
  const gazeSceneQuat = new THREE.Quaternion();
  const gazeLocalDir = new THREE.Vector3();
  const gazeDeltaEuler = new THREE.Euler(0, 0, 0, "YXZ");
  const gazeDeltaQuat = new THREE.Quaternion();

  /**
   * One frame of camera-gaze tracking — called after mixer.update, before vrm.update,
   * so the head/neck nudge rides on the posed skeleton into the humanoid/spring apply
   * and the eyes (driven via lookAt inside vrm.update) compose on the nudged head.
   *
   * Reads the camera's eccentricity from the body front (zone weights) and the residual
   * yaw/pitch from the motion-posed head to the camera (the angle eyes+head must close),
   * damps toward the shaped targets, then post-multiplies the head/neck bones and sets
   * the eye yaw/pitch. Additive over whatever motion is playing — a motion already facing
   * the camera yields a ~0 residual ⇒ ~0 nudge. No-op (no bone writes) once settled.
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
    const trackable = gazeEnabled && gazeHeadBone !== null;
    if (trackable) {
      try {
        const head = gazeHeadBone as THREE.Object3D;
        head.getWorldPosition(gazeHeadPos);
        head.getWorldQuaternion(gazeHeadQuat);
        // Body front (+Z of the VRM scene) drives the zone eccentricity (camera-from-front).
        currentVrm.scene.getWorldQuaternion(gazeSceneQuat);
        gazeBodyFwd.set(0, 0, 1).applyQuaternion(gazeSceneQuat).normalize();
        gazeToCam.copy(camera.position).sub(gazeHeadPos).normalize();
        eccentricityDeg = Math.acos(clampUnit(gazeToCam.dot(gazeBodyFwd))) * RAD2DEG;
        // Residual from the posed head's forward to the camera, in head-local axes
        // (matches applyYawPitch's euler(pitch·X, yaw·Y, YXZ): yaw=atan2(x,z), pitch=-asin(y)).
        gazeHeadQuatInv.copy(gazeHeadQuat).invert();
        gazeLocalDir.copy(gazeToCam).applyQuaternion(gazeHeadQuatInv);
        residualYawDeg = Math.atan2(gazeLocalDir.x, gazeLocalDir.z) * RAD2DEG;
        residualPitchDeg = -Math.asin(clampUnit(gazeLocalDir.y)) * RAD2DEG;
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
    getEnabled() {
      return gazeEnabled;
    },
  };
}
