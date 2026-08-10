/**
 * VrmParticipant — the shared per-frame lifecycle every VRM-bound sub-controller
 * (perch/peek pins, cursor gaze, emotion crossfade, mouth lipsync) implements, so
 * animate()/loadVRM/disposeCurrent/the frame gate hand-sequence one fixed-order
 * array instead of four mismatched vocabularies (onVrmLoaded/onVrmDisposed/reset;
 * step; isConverging/isFading/openValue).
 *
 * Pure orchestration only — no DOM/GL/VRM-library state. index.ts adapts each
 * sub-controller (built once at renderer construction, not per frame) into this
 * shape and holds them in one fixed array.
 */

import type { VRM } from "@pixiv/three-vrm";

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
  /** Release owned GPU/DOM resources (renderer teardown only). */
  dispose?(): void;
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
