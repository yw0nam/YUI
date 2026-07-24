/**
 * gaze-tracker — pure camera-gaze math (no three.js side effects, node-testable).
 *
 * Turns the camera's angular eccentricity from the character's front into eye/head
 * tracking targets via a 4-stage zone curve, then exponentially damps each angle.
 * The apply layer (renderer/index.ts stepGaze) feeds in the per-frame residual
 * yaw/pitch and eccentricity and writes the damped output to the VRM bones/lookAt.
 *
 * 4-stage curve by eccentricity (degrees from front):
 *   ≤deadDeg            no tracking (kills micro-jitter)
 *   deadDeg→engageDeg   eyes ramp in, head still
 *   engageDeg→disengage head ramps in (eyes lead), split across neck+head
 *   ≥disengageDeg       disengage — targets 0, damping eases back to neutral
 */

export interface GazeConfig {
  /** No tracking within this eccentricity (degrees). */
  deadDeg: number;
  /** Eyes reach full tracking by here; head starts recruiting past it (degrees). */
  headEngageDeg: number;
  /** Beyond this the character disengages — can't crane the neck around (degrees). */
  disengageDeg: number;
  /** Max head-bone yaw (degrees). */
  maxHeadYaw: number;
  /** Max head-bone pitch (degrees). */
  maxHeadPitch: number;
  /** Max eye yaw/pitch (degrees). */
  eyeMaxDeg: number;
  /** Fraction of the head rotation taken by the head bone; the rest goes to neck. */
  headNeckSplit: number;
  /** Exponential damping rate (1/s) for k = 1-exp(-smooth·dt). */
  smooth: number;
}

export interface GazeWeights {
  eyeWeight: number;
  headWeight: number;
}

export interface GazeTargets {
  headYaw: number;
  headPitch: number;
  eyeYaw: number;
  eyePitch: number;
}

/** Persistent damped gaze angles (degrees) carried frame to frame. */
export type GazeState = GazeTargets;

/** All-zero gaze (looking straight ahead). */
export const NEUTRAL_GAZE: GazeState = { headYaw: 0, headPitch: 0, eyeYaw: 0, eyePitch: 0 };

/** Below this |Δ| (degrees) an angle is treated as settled — snaps + stops converging. */
const SETTLE_EPS_DEG = 0.05;

/** Per-frame inputs for {@link advanceGaze}. residual/eccentricity are ignored when disabled. */
interface GazeInput {
  /** Gaze tracking on. Off (or no camera/VRM) ⇒ targets are neutral and the state eases home. */
  enabled: boolean;
  /** Residual yaw (deg) from the posed-head forward to the camera. */
  residualYawDeg: number;
  /** Residual pitch (deg) from the posed-head forward to the camera. */
  residualPitchDeg: number;
  /** Body-relative eccentricity (deg) driving the zone curve. */
  eccentricityDeg: number;
}

/** Result of one {@link advanceGaze} step. */
export interface GazeAdvance {
  /** Next damped angles — also the values to write to the bones/lookAt this frame. */
  state: GazeState;
  /** Still easing toward target ⇒ keep frames flowing (frame-gate input). */
  converging: boolean;
  /** Any angle is non-negligible ⇒ the apply layer should write bones this frame. */
  active: boolean;
}

/** Hermite smoothstep — 0 below edge0, 1 above edge1, smooth in between. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Clamp a value to the symmetric range [-max, max]. */
export function clampDeg(v: number, max: number): number {
  return Math.min(max, Math.max(-max, v));
}

/** 4-stage zone curve ⇒ eye/head tracking weights for the given eccentricity (deg). */
export function gazeShape(eccentricityDeg: number, cfg: GazeConfig): GazeWeights {
  if (eccentricityDeg <= cfg.deadDeg || eccentricityDeg >= cfg.disengageDeg) {
    return { eyeWeight: 0, headWeight: 0 };
  }
  return {
    eyeWeight: smoothstep(cfg.deadDeg, cfg.headEngageDeg, eccentricityDeg),
    headWeight: smoothstep(cfg.headEngageDeg, cfg.disengageDeg, eccentricityDeg),
  };
}

/**
 * Shape the residual yaw/pitch (posed-head → camera) into clamped eye/head targets.
 * The head takes its weighted share (clamped); the eyes close the remainder after the
 * head turns (clamped to the eye range, scaled by eyeWeight so they lead then settle).
 */
export function gazeTargets(
  residualYawDeg: number,
  residualPitchDeg: number,
  eccentricityDeg: number,
  cfg: GazeConfig,
): GazeTargets {
  const { eyeWeight, headWeight } = gazeShape(eccentricityDeg, cfg);
  const headYaw = clampDeg(residualYawDeg * headWeight, cfg.maxHeadYaw);
  const headPitch = clampDeg(residualPitchDeg * headWeight, cfg.maxHeadPitch);
  const eyeYaw = clampDeg((residualYawDeg - headYaw) * eyeWeight, cfg.eyeMaxDeg);
  const eyePitch = clampDeg((residualPitchDeg - headPitch) * eyeWeight, cfg.eyeMaxDeg);
  return { headYaw, headPitch, eyeYaw, eyePitch };
}

/** One exponential-damping step toward target: prev + (target-prev)·(1-exp(-smooth·dt)). */
export function dampAngle(prev: number, target: number, smooth: number, dt: number): number {
  const k = 1 - Math.exp(-smooth * dt);
  return prev + (target - prev) * k;
}

/**
 * Advance the damped gaze state one frame. Enabled ⇒ damp toward the shaped targets;
 * disabled (or no camera/VRM) ⇒ targets are neutral so the state eases home. Angles
 * within {@link SETTLE_EPS_DEG} of their target snap exactly and stop converging, so a
 * held/neutral gaze is a true no-op (the apply layer skips bone writes when !active).
 */
export function advanceGaze(
  prev: GazeState,
  input: GazeInput,
  cfg: GazeConfig,
  dt: number,
): GazeAdvance {
  const target = input.enabled
    ? gazeTargets(input.residualYawDeg, input.residualPitchDeg, input.eccentricityDeg, cfg)
    : NEUTRAL_GAZE;

  let converging = false;
  let active = false;
  const step = (p: number, t: number): number => {
    let n = dampAngle(p, t, cfg.smooth, dt);
    if (Math.abs(n - t) < SETTLE_EPS_DEG) n = t;
    else converging = true;
    if (Math.abs(n) >= SETTLE_EPS_DEG) active = true;
    return n;
  };

  const state: GazeState = {
    headYaw: step(prev.headYaw, target.headYaw),
    headPitch: step(prev.headPitch, target.headPitch),
    eyeYaw: step(prev.eyeYaw, target.eyeYaw),
    eyePitch: step(prev.eyePitch, target.eyePitch),
  };
  return { state, converging, active };
}

/** Split a head rotation across the head and neck bones (whole to head when no neck). */
export function splitHeadNeck(
  totalDeg: number,
  headNeckSplit: number,
  hasNeck: boolean,
): { head: number; neck: number } {
  if (!hasNeck) return { head: totalDeg, neck: 0 };
  return { head: totalDeg * headNeckSplit, neck: totalDeg * (1 - headNeckSplit) };
}
