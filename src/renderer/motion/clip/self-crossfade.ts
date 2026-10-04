import type { AnimationClip } from "three";

/**
 * vrma_path + mirror + root-lock flags → clip-cache key. Must match loadClip's key
 * composition. The root lock belongs to the registry entry while the cache is keyed by
 * path, so it has to be in the key: two entries can share one .vrma and disagree on it.
 */
export function clipCacheKey(vrmaPath: string, mirrored: boolean, rootLockY = false): string {
  return `${vrmaPath}${mirrored ? "#mirror" : ""}${rootLockY ? "#ylock" : ""}`;
}

/**
 * Resolves the clip an action should play, unless a same-clip re-trigger with a fade is
 * in flight: clipAction caches one action per clip, and reset+fadeIn on the sole active
 * action dips weight below 1, blending toward the bind pose — so that case must
 * crossfade via a cloned clip instead. Mutates `clones`: stores the clone under the
 * clip's uuid for reuse. Cycle-free by design: any same-clip re-trigger clones,
 * whether the motion loops, cycles, or plays once.
 */
export function playbackClip(
  clip: AnimationClip,
  prevClip: AnimationClip | null,
  fadeMs: number,
  clones: Map<string, AnimationClip>,
): AnimationClip {
  if (fadeMs <= 0 || !prevClip || prevClip.uuid !== clip.uuid) return clip;

  let cloneClip = clones.get(clip.uuid);
  if (!cloneClip) {
    cloneClip = clip.clone();
    clones.set(clip.uuid, cloneClip);
  }
  return cloneClip;
}
