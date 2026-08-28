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
  restY?: number,
): { values: Float32Array; travel: number; shift: number } {
  const out = new Float32Array(values);
  const count = times.length;
  if (count < 1 || values.length !== count * 3) return { values: out, travel: 0, shift: 0 };

  const span = count > 1 ? times[count - 1] - times[0] : 0;
  const rise = count > 1 ? out[(count - 1) * 3 + 1] - out[1] : 0;
  const travel = span > 0 ? rise : 0;
  if (travel !== 0) {
    for (let i = 0; i < count; i++) {
      out[i * 3 + 1] -= travel * ((times[i] - times[0]) / span);
    }
  }

  // A climb clip opens wherever its capture did — often a metre above standing — and
  // that offset would play out in the canvas. Rest the detrended track on the body's
  // own hips height instead, so only the motion inside the clip shows.
  const shift = restY === undefined ? 0 : restY - out[1];
  if (shift !== 0) {
    for (let i = 0; i < count; i++) out[i * 3 + 1] += shift;
  }
  return { values: out, travel, shift };
}

/** A clip's own vertical rise over time: keyframe times, and metres from the first key. */
export interface RootYCurve {
  times: number[];
  values: number[];
}

/** The rise a translation track carries, as a curve from its first key. null when it has none. */
export function rootYCurve(times: ArrayLike<number>, values: ArrayLike<number>): RootYCurve | null {
  const count = times.length;
  if (count < 2 || values.length !== count * 3) return null;
  const out: RootYCurve = { times: [], values: [] };
  for (let i = 0; i < count; i++) {
    out.times.push(times[i]);
    out.values.push(values[i * 3 + 1] - values[1]);
  }
  return out;
}

/** The curve's value at a clip time, interpolated between keys and clamped at both ends. */
export function sampleRootYCurve(curve: RootYCurve, timeS: number): number {
  const { times, values } = curve;
  const last = times.length - 1;
  if (last < 0) return 0;
  if (timeS <= times[0]) return values[0];
  if (timeS >= times[last]) return values[last];
  let i = 1;
  while (i < last && times[i] < timeS) i++;
  const span = times[i] - times[i - 1];
  if (!(span > 0)) return values[i];
  const t = (timeS - times[i - 1]) / span;
  return values[i - 1] + (values[i] - values[i - 1]) * t;
}

/**
 * Detrend every translation track of a clip in place. Returns the largest travel
 * removed (signed metres) — a VRMA carries one hips track, so that is the clip's own.
 */
export function detrendClipRootY(
  clip: AnimationClip,
  restY?: number,
): { travel: number; shift: number; curve: RootYCurve | null } {
  let travel = 0;
  let shift = 0;
  let curve: RootYCurve | null = null;
  for (const track of clip.tracks) {
    if (!track.name.endsWith(".position")) continue;
    // Read the rise before detrending — it is what the mover has to supply.
    const own = rootYCurve(track.times, track.values);
    const detrended = detrendRootY(track.times, track.values, restY);
    track.values = detrended.values;
    if (Math.abs(detrended.travel) > Math.abs(travel)) {
      travel = detrended.travel;
      shift = detrended.shift;
      curve = own;
    } else if (curve === null) {
      shift = detrended.shift;
      curve = own;
    }
  }
  return { travel, shift, curve };
}
