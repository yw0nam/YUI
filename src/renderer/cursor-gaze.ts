/**
 * Cursor-gaze head/eye tracking — the stateful three.js apply layer over the
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

/** Default cursor-gaze tracking — the "natural" preset; overridden by configs/avatar.json `gaze`. */
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

/** Below this squared distance (world units) from the head, a cursor-derived target is unusable. */
const TARGET_EPSILON_SQ = 1e-8;

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

/** Window-local CSS px → NDC. Values outside [-1, 1] are expected (cursor outside the window). */
export function cssToNdc(x: number, y: number, w: number, h: number): { x: number; y: number } {
  return { x: (x / w) * 2 - 1, y: -((y / h) * 2 - 1) };
}

/**
 * World-space gaze target at half the camera-to-head distance along `dir`, so it can never
 * land on the head. Writes into `out`; returns false when the result is still degenerately
 * close to the head (guards a near-zero camera-head separation).
 */
export function computeCursorTarget(
  cameraPos: THREE.Vector3,
  dir: THREE.Vector3,
  headPos: THREE.Vector3,
  out: THREE.Vector3,
): boolean {
  const dist = 0.5 * cameraPos.distanceTo(headPos);
  out.copy(dir).normalize().multiplyScalar(dist).add(cameraPos);
  return out.distanceToSquared(headPos) >= TARGET_EPSILON_SQ;
}

/** Body-relative gaze geometry derived from the target, head, and body orientation. */
export interface GazeGeometry {
  /** Target angle from the body front (degrees) — drives the zone curve. */
  eccentricityDeg: number;
  /** Body-frame yaw to bring the body front onto the target (degrees). */
  residualYawDeg: number;
  /** Body-frame pitch to bring the body front onto the target (degrees). */
  residualPitchDeg: number;
}

/** Reusable temporaries for {@link computeGazeGeometry} so the per-frame path allocates nothing. */
export interface GazeGeometryScratch {
  bodyFwd: THREE.Vector3;
  toCam: THREE.Vector3;
  localDir: THREE.Vector3;
  invQuat: THREE.Quaternion;
}

/** Fresh scratch — production callers create one and reuse it; tests can omit it. */
export function makeGazeGeometryScratch(): GazeGeometryScratch {
  return {
    bodyFwd: new THREE.Vector3(),
    toCam: new THREE.Vector3(),
    localDir: new THREE.Vector3(),
    invQuat: new THREE.Quaternion(),
  };
}

/**
 * Pure gaze geometry: the body-relative angle to an arbitrary world-space target. three-vrm
 * normalizes every VRM to face -Z, so the body front is the scene's local -Z. Both the
 * eccentricity and the residual yaw/pitch are measured in the BODY (scene) frame — independent
 * of the live idle-posed head — so the eyes/head bias toward the target without chasing idle
 * head motion. The residual matches the apply's euler(pitch·X, yaw·Y, YXZ) rotating -Z:
 * yaw=atan2(-x,-z), pitch=asin(y).
 *
 * Pass `scratch` on the per-frame path to avoid allocation; omit it in tests.
 */
export function computeGazeGeometry(
  targetPos: THREE.Vector3,
  headPos: THREE.Vector3,
  sceneQuat: THREE.Quaternion,
  scratch: GazeGeometryScratch = makeGazeGeometryScratch(),
): GazeGeometry {
  const bodyFwd = scratch.bodyFwd.set(0, 0, -1).applyQuaternion(sceneQuat).normalize();
  const toCam = scratch.toCam.copy(targetPos).sub(headPos).normalize();
  const eccentricityDeg = Math.acos(clampUnit(toCam.dot(bodyFwd))) * RAD2DEG;
  const invQuat = scratch.invQuat.copy(sceneQuat).invert();
  const localDir = scratch.localDir.copy(toCam).applyQuaternion(invQuat);
  const residualYawDeg = Math.atan2(-localDir.x, -localDir.z) * RAD2DEG;
  const residualPitchDeg = Math.asin(clampUnit(localDir.y)) * RAD2DEG;
  return { eccentricityDeg, residualYawDeg, residualPitchDeg };
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
  /** Mount element width (CSS px) — cursor→NDC mapping. */
  mountWidth(): number;
  /** Mount element height (CSS px) — cursor→NDC mapping. */
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
  /** Current toggle state (true = tracking the cursor). */
  getEnabled(): boolean;
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
  // Scratch reused every frame for the world-transform reads + geometry + bone-nudge apply.
  const gazeHeadPos = new THREE.Vector3();
  const gazeSceneQuat = new THREE.Quaternion();
  const gazeCursorDir = new THREE.Vector3();
  const gazeTargetPos = new THREE.Vector3();
  const gazeGeoScratch = makeGazeGeometryScratch();
  const gazeDeltaEuler = new THREE.Euler(0, 0, 0, "YXZ");
  const gazeDeltaQuat = new THREE.Quaternion();

  /**
   * One frame of cursor-gaze tracking — called after mixer.update, before vrm.update,
   * so the head/neck nudge rides on the posed skeleton into the humanoid/spring apply
   * and the eyes (driven via lookAt inside vrm.update) compose on the nudged head.
   *
   * Unprojects the cursor's NDC through the camera at half the camera-head distance to get
   * a world-space target, reads its eccentricity and residual yaw/pitch in the BODY frame
   * (see computeGazeGeometry), damps toward the shaped targets, then post-multiplies the
   * head/neck bones and sets the eye yaw/pitch. Additive over whatever motion is playing.
   * No-op (no bone writes) once settled.
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
    let trackable = gazeEnabled && gazeHeadBone !== null && gazeCursor !== null;
    if (trackable) {
      try {
        const head = gazeHeadBone as THREE.Object3D;
        const cursor = gazeCursor as { x: number; y: number };
        head.getWorldPosition(gazeHeadPos);
        currentVrm.scene.getWorldQuaternion(gazeSceneQuat);
        const ndc = cssToNdc(cursor.x, cursor.y, mountWidth(), mountHeight());
        gazeCursorDir.set(ndc.x, ndc.y, 0.5).unproject(camera).sub(camera.position).normalize();
        const usable = computeCursorTarget(
          camera.position,
          gazeCursorDir,
          gazeHeadPos,
          gazeTargetPos,
        );
        if (!usable) {
          trackable = false;
        } else {
          const geo = computeGazeGeometry(
            gazeTargetPos,
            gazeHeadPos,
            gazeSceneQuat,
            gazeGeoScratch,
          );
          eccentricityDeg = geo.eccentricityDeg;
          residualYawDeg = geo.residualYawDeg;
          residualPitchDeg = geo.residualPitchDeg;
        }
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
    setCursorCss(pos) {
      gazeCursor = pos;
    },
  };
}
