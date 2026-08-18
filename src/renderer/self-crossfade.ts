import type { AnimationClip } from "three";

/** vrma_path + mirror flag → clip-cache key. Must match loadClip's key composition. */
export function clipCacheKey(vrmaPath: string, mirrored: boolean): string {
  return mirrored ? `${vrmaPath}#mirror` : vrmaPath;
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
): AnimationClip {
  const cacheKey = clipCacheKey(vrmaPath, mirrored);
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
