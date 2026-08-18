import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { selfCrossfadeClip } from "./self-crossfade";

function makeClip(): THREE.AnimationClip {
  return new THREE.AnimationClip("calm", 1, [
    new THREE.VectorKeyframeTrack(".position", [0, 1], [0, 0, 0, 1, 1, 1]),
  ]);
}

describe("self-crossfade defect (bind-pose dip on same-action reset+fadeIn)", () => {
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

describe("selfCrossfadeClip", () => {
  it("returns the input clip unchanged on first play (no prev clip)", () => {
    const clip = makeClip();
    const cache = new Map<string, THREE.AnimationClip>();

    const result = selfCrossfadeClip(clip, null, 200, cache, "calm.vrma");

    expect(result).toBe(clip);
  });

  it("returns a cloned clip for a same-clip re-trigger, and crossfading it keeps combined weight at 1", () => {
    const root = new THREE.Object3D();
    const mixer = new THREE.AnimationMixer(root);
    const clip = makeClip();
    const cache = new Map<string, THREE.AnimationClip>();
    const cacheKey = "calm.vrma";

    const firstClip = selfCrossfadeClip(clip, null, 200, cache, cacheKey);
    const prevAction = mixer.clipAction(firstClip);
    prevAction.play();
    mixer.update(0.5);

    const nextClip = selfCrossfadeClip(clip, prevAction.getClip(), 200, cache, cacheKey);

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

  it("passes the clip through unchanged when fadeMs is 0", () => {
    const clip = makeClip();
    const cache = new Map<string, THREE.AnimationClip>();

    const result = selfCrossfadeClip(clip, clip, 0, cache, "calm.vrma");

    expect(result).toBe(clip);
  });

  it("passes the clip through unchanged when the previous clip differs", () => {
    const clip = makeClip();
    const otherClip = makeClip();
    const cache = new Map<string, THREE.AnimationClip>();

    const result = selfCrossfadeClip(clip, otherClip, 200, cache, "calm.vrma");

    expect(result).toBe(clip);
  });

  it("reuses the same cloned instance across calls with the same key", () => {
    const clip = makeClip();
    const cache = new Map<string, THREE.AnimationClip>();
    const cacheKey = "calm.vrma";

    const first = selfCrossfadeClip(clip, clip, 200, cache, cacheKey);
    const second = selfCrossfadeClip(clip, clip, 200, cache, cacheKey);

    expect(first).toBe(second);
  });
});
