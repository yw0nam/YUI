import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { clipCacheKey, playbackClip } from "./self-crossfade";

function makeClip(): THREE.AnimationClip {
  return new THREE.AnimationClip("calm", 1, [
    new THREE.VectorKeyframeTrack(".position", [0, 1], [0, 0, 0, 1, 1, 1]),
  ]);
}

describe("three.js characterization: reset+fadeIn dips the sole active action's weight below 1", () => {
  it("reset+fadeIn on the sole active action dips its weight below 1", () => {
    const root = new THREE.Object3D();
    const mixer = new THREE.AnimationMixer(root);
    const clip = makeClip();

    const action = mixer.clipAction(clip);
    action.play();
    mixer.update(0.5);

    // Buggy same-clip re-trigger: reset+fadeIn ramps the sole active action's weight
    // down from 1 and back up, dipping the mixer toward the bind pose mid-fade.
    action.reset();
    action.fadeIn(0.2);
    action.play();
    mixer.update(0.1);

    expect(action.getEffectiveWeight()).toBeLessThan(1);
  });
});

describe("three.js characterization: crossFadeFrom does not silence the outgoing action's own 'finished'", () => {
  it("dispatches finished for the outgoing action mid-fade, motivating actionToId cleanup on replace", () => {
    const root = new THREE.Object3D();
    const mixer = new THREE.AnimationMixer(root);
    const clip = makeClip(); // 1s duration

    const outgoing = mixer.clipAction(clip);
    outgoing.setLoop(THREE.LoopOnce, 1);
    outgoing.clampWhenFinished = true;
    outgoing.play();
    mixer.update(0.95); // near the clip's own end

    const incoming = mixer.clipAction(clip.clone());
    incoming.reset();
    incoming.enabled = true;
    incoming.crossFadeFrom(outgoing, 0.2, false).play();

    let finishedAction: THREE.AnimationAction | null = null;
    mixer.addEventListener("finished", (e) => {
      finishedAction = e.action;
    });

    // Crosses the outgoing clip's own end while the crossfade is still in progress.
    mixer.update(0.1);

    expect(finishedAction).toBe(outgoing);
  });
});

describe("clipCacheKey", () => {
  it("appends #mirror only when mirrored", () => {
    expect(clipCacheKey("calm.vrma", false)).toBe("calm.vrma");
    expect(clipCacheKey("calm.vrma", true)).toBe("calm.vrma#mirror");
  });
});

describe("playbackClip", () => {
  it("returns the cached clip unchanged on first play (no prev clip)", () => {
    const clip = makeClip();
    const cache = new Map<string, THREE.AnimationClip>();
    cache.set("calm.vrma", clip);

    const result = playbackClip("calm.vrma", false, null, 200, cache);

    expect(result).toBe(clip);
  });

  it("returns a cloned clip for a same-clip re-trigger, and crossfading it keeps combined weight at 1", () => {
    const root = new THREE.Object3D();
    const mixer = new THREE.AnimationMixer(root);
    const clip = makeClip();
    const cache = new Map<string, THREE.AnimationClip>();
    const vrmaPath = "calm.vrma";
    cache.set(vrmaPath, clip);

    const firstClip = playbackClip(vrmaPath, false, null, 200, cache);
    const prevAction = mixer.clipAction(firstClip);
    prevAction.play();
    mixer.update(0.5);

    const nextClip = playbackClip(vrmaPath, false, prevAction.getClip(), 200, cache);

    expect(nextClip).not.toBe(clip);
    const nextAction = mixer.clipAction(nextClip);
    expect(nextAction).not.toBe(prevAction);

    nextAction.reset();
    nextAction.enabled = true;
    nextAction.crossFadeFrom(prevAction, 0.2, false).play();

    for (let i = 0; i < 4; i++) {
      mixer.update(0.05);
      expect(prevAction.getEffectiveWeight() + nextAction.getEffectiveWeight()).toBeCloseTo(1, 6);
    }
  });

  it("clones on a same-clip re-trigger for a non-cycle, oneshot-style motion too — the decision is cycle-agnostic", () => {
    const clip = makeClip();
    const cache = new Map<string, THREE.AnimationClip>();
    const vrmaPath = "wave.vrma"; // a oneshot motion, not a cycle motion
    cache.set(vrmaPath, clip);

    const first = playbackClip(vrmaPath, false, null, 200, cache);
    const second = playbackClip(vrmaPath, false, first, 200, cache);

    expect(second).not.toBe(clip);
  });

  it("caches the mirrored clone under a distinct key from the unmirrored clone", () => {
    const clip = makeClip();
    const mirroredClip = makeClip();
    const cache = new Map<string, THREE.AnimationClip>();
    const vrmaPath = "calm.vrma";
    cache.set(vrmaPath, clip);
    cache.set(`${vrmaPath}#mirror`, mirroredClip);

    const unmirroredClone = playbackClip(vrmaPath, false, clip, 200, cache);
    const mirroredClone = playbackClip(vrmaPath, true, mirroredClip, 200, cache);

    expect(cache.get(`${vrmaPath}#xfade`)).toBe(unmirroredClone);
    expect(cache.get(`${vrmaPath}#mirror#xfade`)).toBe(mirroredClone);
    expect(unmirroredClone).not.toBe(mirroredClone);
  });

  it("passes the clip through unchanged when fadeMs is 0", () => {
    const clip = makeClip();
    const cache = new Map<string, THREE.AnimationClip>();
    cache.set("calm.vrma", clip);

    const result = playbackClip("calm.vrma", false, clip, 0, cache);

    expect(result).toBe(clip);
  });

  it("passes the clip through unchanged when the previous clip differs", () => {
    const clip = makeClip();
    const otherClip = makeClip();
    const cache = new Map<string, THREE.AnimationClip>();
    cache.set("calm.vrma", clip);

    const result = playbackClip("calm.vrma", false, otherClip, 200, cache);

    expect(result).toBe(clip);
  });

  it("reuses the same cloned instance across calls with the same key", () => {
    const clip = makeClip();
    const cache = new Map<string, THREE.AnimationClip>();
    const vrmaPath = "calm.vrma";
    cache.set(vrmaPath, clip);

    const first = playbackClip(vrmaPath, false, clip, 200, cache);
    const second = playbackClip(vrmaPath, false, clip, 200, cache);

    expect(first).toBe(second);
  });

  it("alternating from the clone back to the original returns the original clip and creates no additional clone", () => {
    const clip = makeClip();
    const cache = new Map<string, THREE.AnimationClip>();
    const vrmaPath = "calm.vrma";
    cache.set(vrmaPath, clip);

    const cloned = playbackClip(vrmaPath, false, clip, 200, cache);
    expect(cloned).not.toBe(clip);

    // prev is now the clone (a different uuid from the base clip), so the base clip
    // resolves unchanged rather than producing a second clone.
    const result = playbackClip(vrmaPath, false, cloned, 200, cache);

    expect(result).toBe(clip);
    const xfadeEntries = Array.from(cache.keys()).filter((key) => key.endsWith("#xfade"));
    expect(xfadeEntries).toHaveLength(1);
  });
});
