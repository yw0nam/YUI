/**
 * recenter-root-motion — strip baked horizontal drift from VRMA root motion.
 *
 * createVRMAnimationClip bakes the hips position track as a flat [x,y,z, ...]
 * buffer without recentering it, so idle clips carry a large horizontal ROOT
 * offset that drags the pet sideways. Recentering X/Z around their own mean
 * keeps the character on origin while preserving vertical bob and lively sway.
 *
 * Vertical travel is left alone by default — the bob is the point. A clip whose
 * rise is the movement itself, like the climbs, is detrended instead: the travel
 * comes out of the clip and the window supplies it, so it never plays twice.
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

/**
 * Remove a track's end-to-end vertical travel by subtracting it linearly over the
 * track's own time span. The bob survives, because it is what deviates from that line,
 * and the last key lands back on the first, so a loop no longer snaps back at the seam.
 * `travel` is the removed rise (signed metres) — what a mover has to supply instead.
 */
export function detrendRootY(
  times: ArrayLike<number>,
  values: ArrayLike<number>,
): { values: Float32Array; travel: number } {
  const out = new Float32Array(values);
  const count = times.length;
  if (count < 2 || values.length !== count * 3) return { values: out, travel: 0 };

  const span = times[count - 1] - times[0];
  const travel = out[(count - 1) * 3 + 1] - out[1];
  if (!(span > 0) || travel === 0) return { values: out, travel: 0 };

  for (let i = 0; i < count; i++) {
    out[i * 3 + 1] -= travel * ((times[i] - times[0]) / span);
  }
  return { values: out, travel };
}

/**
 * Detrend every translation track of a clip in place. Returns the largest travel
 * removed (signed metres) — a VRMA carries one hips track, so that is the clip's own.
 */
export function detrendClipRootY(clip: AnimationClip): number {
  let travel = 0;
  for (const track of clip.tracks) {
    if (!track.name.endsWith(".position")) continue;
    const detrended = detrendRootY(track.times, track.values);
    track.values = detrended.values;
    if (Math.abs(detrended.travel) > Math.abs(travel)) travel = detrended.travel;
  }
  return travel;
}
