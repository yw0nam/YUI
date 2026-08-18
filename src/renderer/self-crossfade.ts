import type { AnimationClip } from "three";

/**
 * Same-clip re-trigger with a fade must crossfade via a cloned clip: clipAction caches
 * one action per clip, and reset+fadeIn on the sole active action dips weight below 1,
 * blending toward the bind pose.
 */
export function selfCrossfadeClip(
  clip: AnimationClip,
  prevClip: AnimationClip | null,
  fadeMs: number,
  cache: Map<string, AnimationClip>,
  cacheKey: string,
): AnimationClip {
  if (fadeMs <= 0 || !prevClip || prevClip.uuid !== clip.uuid) return clip;

  const cloneKey = `${cacheKey}#xfade`;
  let cloneClip = cache.get(cloneKey);
  if (!cloneClip) {
    cloneClip = clip.clone();
    cache.set(cloneKey, cloneClip);
  }
  return cloneClip;
}
