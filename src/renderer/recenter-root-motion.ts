/**
 * recenter-root-motion — strip baked horizontal drift from VRMA root motion.
 *
 * createVRMAnimationClip bakes the hips position track as a flat [x,y,z, ...]
 * buffer without recentering it, so idle clips carry a large horizontal ROOT
 * offset that drags the pet sideways. Recentering X/Z around their own mean
 * keeps the character on origin while preserving vertical bob and lively sway.
 */

import type { AnimationClip } from "three";

/** Recenter a flat [x,y,z, ...] buffer: subtract mean X and mean Z, keep Y. */
export function recenterRootTranslation(values: ArrayLike<number>): Float32Array {
  const out = new Float32Array(values);

  const count = Math.floor(values.length / 3);
  if (count === 0 || values.length % 3 !== 0) return out;

  let sumX = 0;
  let sumZ = 0;
  for (let i = 0; i < count; i++) {
    sumX += out[i * 3];
    sumZ += out[i * 3 + 2];
  }
  const meanX = sumX / count;
  const meanZ = sumZ / count;

  for (let i = 0; i < count; i++) {
    out[i * 3] -= meanX;
    out[i * 3 + 2] -= meanZ;
  }
  return out;
}

/** Recenter every translation (`*.position`) track of a clip in place. */
export function recenterClipRootMotion(clip: AnimationClip): void {
  for (const track of clip.tracks) {
    if (track.name.endsWith(".position")) {
      track.values = recenterRootTranslation(track.values);
    }
  }
}
