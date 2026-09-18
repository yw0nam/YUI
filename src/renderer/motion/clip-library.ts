/** Per-VRM .vrma clip cache: load, mirror, root-lock detrend, dead-clip memo, crossfade clone. */
import { type VRM, VRMHumanBoneList, type VRMHumanBoneName } from "@pixiv/three-vrm";
import { createVRMAnimationClip } from "@pixiv/three-vrm-animation";
import * as THREE from "three";
import type { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { MotionRegistry } from "../../contract";
import type { Logger } from "../../logger";
import { mirrorClipTracks } from "./mirror-clip";
import { createDeadClipRegistry } from "./motion-fallback";
import {
  detrendClipRootY,
  type RootYCurve,
  recenterClipRootMotion,
  sampleRootYCurve,
} from "./recenter-root-motion";
import { clipCacheKey, playbackClip } from "./self-crossfade";

export interface ClipLibrary {
  onVrmLoaded(vrm: VRM): void;
  onVrmDisposed(): void;
  /** vrma_path → AnimationClip for the loaded VRM, mirrored per the current mirror flag; null on failure or when overtaken by a VRM swap. */
  load(vrmaPath: string, rootLockY?: boolean): Promise<THREE.AnimationClip | null>;
  /** The clip an action should play: `clip` itself, or its crossfade clone for a same-clip re-trigger with a fade. */
  playbackClip(
    clip: THREE.AnimationClip,
    prevClip: THREE.AnimationClip | null,
    fadeMs: number,
  ): THREE.AnimationClip;
  setMirror(on: boolean): void;
  duration(id: string): number | null;
  travelY(id: string): number | null;
  travelAt(id: string, timeS: number): number | null;
  preload(id: string): Promise<void>;
}

export function createClipLibrary(deps: {
  loader: Pick<GLTFLoader, "loadAsync">;
  getRegistry: () => MotionRegistry | undefined;
  log: Pick<Logger, "debug" | "warn">;
}): ClipLibrary {
  const { loader, getRegistry, log } = deps;

  /** (vrma_path → AnimationClip) cache — clips are VRM-specific so cleared on hotswap. */
  const clipCache = new Map<string, THREE.AnimationClip>();
  /** Vertical travel (signed metres) levelled out of each cached clip; 0 when not locked. */
  const clipTravelY = new Map<string, number>();
  /** The rise each root-locked clip carries, as a curve a mover can follow. */
  const clipRootCurve = new Map<string, RootYCurve>();
  /** Crossfade clones for same-clip re-triggers, keyed by the base clip's uuid. */
  const xfadeClones = new Map<string, THREE.AnimationClip>();
  /** Hips world y in the loaded VRM's rest pose — where a root-locked clip is anchored. */
  let restHipsY: number | undefined;
  const deadClips = createDeadClipRegistry(log);
  /** Hotswap race guard: if VRM changes during load async, discard. */
  let vrmEpoch = 0;
  let motionMirror = false;
  const boneNameSwap = new Map<string, string>();
  let vrm: VRM | undefined;

  /** Cache key of a registry id's representative clip, under the live mirror state. */
  function registryClipKey(id: string): string | null {
    const entry = getRegistry()?.[id];
    if (!entry) return null;
    return clipCacheKey(entry.vrma_path, motionMirror, !!entry.root_lock_y);
  }

  /**
   * vrma_path → AnimationClip (current VRM only). Returns immediately on cache hit.
   * Load .vrma via GLTFLoader + VRMAnimationLoaderPlugin → gltf.userData.vrmAnimations[0]
   * → createVRMAnimationClip(vrmAnimation, currentVrm) (three-vrm-animation official path).
   */
  async function loadClip(
    vrmaPath: string,
    mirrored: boolean,
    rootLockY = false,
  ): Promise<THREE.AnimationClip | null> {
    const cacheKey = clipCacheKey(vrmaPath, mirrored, rootLockY);
    const cached = clipCache.get(cacheKey);
    if (cached) return cached;
    if (!vrm) return null;

    if (mirrored) {
      const upright = await loadClip(vrmaPath, false, rootLockY);
      if (!upright) return null;
      const clip = mirrorClipTracks(upright, boneNameSwap);
      clipCache.set(cacheKey, clip);
      // Mirroring swaps left/right bones; the vertical travel and its curve are the upright clip's.
      const uprightKey = clipCacheKey(vrmaPath, false, rootLockY);
      clipTravelY.set(cacheKey, clipTravelY.get(uprightKey) ?? 0);
      const curve = clipRootCurve.get(uprightKey);
      if (curve) clipRootCurve.set(cacheKey, curve);
      return clip;
    }

    if (deadClips.isDead(vrmaPath)) return null;
    const epoch = vrmEpoch;
    let gltf: Awaited<ReturnType<typeof loader.loadAsync>>;
    try {
      gltf = await loader.loadAsync(vrmaPath);
    } catch (err) {
      // Fetch/parse failure is asset-permanent (above all an unshipped purchased motion,
      // where the app serves index.html instead) — warn once, never refetch.
      deadClips.markDead(vrmaPath, err);
      return null;
    }
    // If hotswap happened during load, discard.
    if (epoch !== vrmEpoch || !vrm) return null;

    const vrmAnimations = gltf.userData.vrmAnimations as unknown[] | undefined;
    const vrmAnimation = vrmAnimations?.[0];
    if (vrmAnimation == null) {
      deadClips.markDead(vrmaPath, "vrma_no_animations");
      return null;
    }
    const clip = createVRMAnimationClip(vrmAnimation as never, vrm);
    recenterClipRootMotion(clip); // strip baked horizontal root drift so the pet stays centered.
    // A clip whose rise IS the movement plays in place; the mover supplies the travel,
    // following the curve the clip had rather than a straight line through it.
    if (rootLockY) {
      const locked = detrendClipRootY(clip, restHipsY);
      clipTravelY.set(cacheKey, locked.travel);
      if (locked.curve) clipRootCurve.set(cacheKey, locked.curve);
      log.debug("clip.root_locked", {
        vrma_path: vrmaPath,
        travel: locked.travel,
        shift: locked.shift,
        keys: locked.curve?.times.length ?? 0,
      });
    } else {
      clipTravelY.set(cacheKey, 0);
    }
    clipCache.set(cacheKey, clip);
    return clip;
  }

  function rebuildBoneNameSwap(next: VRM): void {
    boneNameSwap.clear();
    for (const leftName of VRMHumanBoneList) {
      if (!leftName.startsWith("left")) continue;
      const rightName = `right${leftName.slice(4)}` as VRMHumanBoneName;
      const leftNode = next.humanoid?.getNormalizedBoneNode(leftName);
      const rightNode = next.humanoid?.getNormalizedBoneNode(rightName);
      if (!leftNode || !rightNode) continue;
      boneNameSwap.set(leftNode.name, rightNode.name);
      boneNameSwap.set(rightNode.name, leftNode.name);
    }
    if (boneNameSwap.size === 0) log.warn("bone_name_swap_empty");
  }

  return {
    onVrmLoaded(next) {
      vrmEpoch += 1; // Invalidate async clip loads tied to prior model.
      vrm = next;
      rebuildBoneNameSwap(next);
      restHipsY = next.humanoid
        ?.getNormalizedBoneNode("hips")
        ?.getWorldPosition(new THREE.Vector3()).y;
    },
    onVrmDisposed() {
      clipCache.clear();
      clipTravelY.clear();
      clipRootCurve.clear();
      xfadeClones.clear();
      restHipsY = undefined;
      motionMirror = false;
      boneNameSwap.clear();
      vrm = undefined;
    },
    load(vrmaPath, rootLockY = false) {
      return loadClip(vrmaPath, motionMirror, rootLockY);
    },
    playbackClip(clip, prevClip, fadeMs) {
      return playbackClip(clip, prevClip, fadeMs, xfadeClones);
    },
    setMirror(on) {
      motionMirror = on;
    },
    duration(id) {
      const key = registryClipKey(id);
      const clip = key ? clipCache.get(key) : undefined;
      return clip ? clip.duration : null;
    },
    travelY(id) {
      const key = registryClipKey(id);
      if (!key || !clipCache.has(key)) return null;
      return clipTravelY.get(key) ?? 0;
    },
    travelAt(id, timeS) {
      const key = registryClipKey(id);
      if (!key || !clipCache.has(key)) return null;
      const curve = clipRootCurve.get(key);
      return curve ? sampleRootYCurve(curve, timeS) : 0;
    },
    async preload(id) {
      const entry = getRegistry()?.[id];
      if (!entry) return;
      await loadClip(entry.vrma_path, motionMirror, !!entry.root_lock_y);
    },
  };
}
