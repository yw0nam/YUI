/**
 * VrmParticipant — the shared per-frame lifecycle every VRM-bound sub-controller
 * (perch/peek pins, cursor gaze, emotion crossfade, mouth lipsync) implements, so
 * animate()/loadVRM/disposeCurrent/the frame gate hand-sequence one fixed-order
 * array instead of four mismatched vocabularies (onVrmLoaded/onVrmDisposed/reset;
 * step; isConverging/isFading/openValue).
 *
 * Pure orchestration only — no DOM/GL state. buildVrmParticipants adapts each
 * sub-controller (called once at renderer construction, not per frame) into this
 * shape and returns them held in one fixed array.
 */

import type { VRM } from "@pixiv/three-vrm";
import type { PerspectiveCamera } from "three";
import type { CursorGaze } from "./cursor-gaze";
import type { EmotionCrossfade } from "./emotion-crossfade";
import { isMouthConverging } from "./frame-gate";
import type { MouthLipsync } from "./mouth-lipsync";
import type { PinController } from "./pin-controller";

/** Per-frame context passed to every participant's step, before vrm.update(dt). */
export interface VrmParticipantContext {
  readonly vrm: VRM;
  readonly dt: number;
  readonly elapsed: number;
}

export interface VrmParticipant {
  /** Adopt a newly (hot)loaded VRM — cache bones, claim lookAt, etc. */
  onVrmLoaded?(vrm: VRM): void;
  /** Drop refs to the disposed VRM and reset any in-flight state. */
  onVrmDisposed?(): void;
  /** One frame of work. Called in fixed array order, before vrm.update(dt). */
  step(ctx: VrmParticipantContext): void;
  /** True while still easing/animating — gates the idle frame cap. */
  isConverging?(): boolean;
}

/** Notify every participant a VRM was (hot)loaded, in array order. */
export function notifyVrmLoaded(participants: readonly VrmParticipant[], vrm: VRM): void {
  for (const p of participants) p.onVrmLoaded?.(vrm);
}

/** Notify every participant the current VRM was disposed, in array order. */
export function notifyVrmDisposed(participants: readonly VrmParticipant[]): void {
  for (const p of participants) p.onVrmDisposed?.();
}

/** Step every participant, in array order. */
export function stepParticipants(
  participants: readonly VrmParticipant[],
  ctx: VrmParticipantContext,
): void {
  for (const p of participants) p.step(ctx);
}

/** True when any participant reports it is still converging. */
export function anyConverging(participants: readonly VrmParticipant[]): boolean {
  for (const p of participants) {
    if (p.isConverging?.()) return true;
  }
  return false;
}

/** The four sub-controllers a renderer instance owns, adapted into one VrmParticipant array. */
export interface VrmParticipantSubControllers {
  pins: PinController;
  gaze: CursorGaze;
  emotion: EmotionCrossfade;
  mouth: MouthLipsync;
  /** Not a participant itself — pins.step needs it and it's stable for the renderer's lifetime. */
  camera: PerspectiveCamera;
}

/**
 * Build the fixed-order VrmParticipant array — pins/gaze (bones) before
 * emotion/mouth (expression weights), matching animate()'s original
 * pins.step → gaze.step → emotion.step → mouth.step order (all before
 * vrm.update). Each sub-controller's methods are closures (no `this`), so
 * referencing them unbound (`pins.onVrmLoaded` rather than
 * `(v) => pins.onVrmLoaded(v)`) is safe.
 */
export function buildVrmParticipants(deps: VrmParticipantSubControllers): VrmParticipant[] {
  const { pins, gaze, emotion, mouth, camera } = deps;

  const pinsParticipant: VrmParticipant = {
    onVrmLoaded: pins.onVrmLoaded,
    onVrmDisposed: pins.onVrmDisposed,
    step: () => pins.step(camera),
    isConverging: pins.isConverging,
  };
  const gazeParticipant: VrmParticipant = {
    onVrmLoaded: gaze.onVrmLoaded,
    onVrmDisposed: gaze.onVrmDisposed,
    step: (ctx) => gaze.step(ctx.dt),
    isConverging: gaze.isConverging,
  };
  const emotionParticipant: VrmParticipant = {
    onVrmLoaded: emotion.onVrmLoaded,
    onVrmDisposed: emotion.reset,
    step: (ctx) => emotion.step(ctx.dt),
    isConverging: emotion.isFading,
  };
  const mouthParticipant: VrmParticipant = {
    step: (ctx) => {
      if (ctx.vrm.expressionManager) mouth.step(ctx.dt, ctx.vrm.expressionManager);
    },
    isConverging: () => isMouthConverging(mouth.openValue()),
  };

  return [pinsParticipant, gazeParticipant, emotionParticipant, mouthParticipant];
}
