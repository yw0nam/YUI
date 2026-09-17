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
 * Resolves the cached clip for a motion, unless a same-clip re-trigger with a fade is
 * in flight: clipAction caches one action per clip, and reset+fadeIn on the sole active
 * action dips weight below 1, blending toward the bind pose — so that case must
 * crossfade via a cloned clip instead. Mutates `cache`: stores the clone under
 * `<key>#xfade` for reuse. Cycle-free by design: any same-clip re-trigger clones,
 * whether the motion loops, cycles, or plays once.
 */
export function playbackClip(
  vrmaPath: string,
  mirrored: boolean,
  prevClip: AnimationClip | null,
  fadeMs: number,
  cache: Map<string, AnimationClip>,
  rootLockY = false,
): AnimationClip {
  const cacheKey = clipCacheKey(vrmaPath, mirrored, rootLockY);
  const clip = cache.get(cacheKey)!;
  if (fadeMs <= 0 || !prevClip || prevClip.uuid !== clip.uuid) return clip;

  const cloneKey = `${cacheKey}#xfade`;
  let cloneClip = cache.get(cloneKey);
  if (!cloneClip) {
    cloneClip = clip.clone();
    cache.set(cloneKey, cloneClip);
  }
  return cloneClip;
}
