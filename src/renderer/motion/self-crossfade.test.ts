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

  it("appends #ylock only when the root is locked vertically", () => {
    // The flag lives on the registry entry but the cache is keyed by path, so two
    // entries sharing one .vrma must not hand each other a detrended clip.
    expect(clipCacheKey("calm.vrma", false, false)).toBe("calm.vrma");
    expect(clipCacheKey("calm.vrma", false, true)).toBe("calm.vrma#ylock");
    expect(clipCacheKey("calm.vrma", true, true)).toBe("calm.vrma#mirror#ylock");
  });
});

describe("playbackClip", () => {
  it("returns the cached clip unchanged on first play (no prev clip)", () => {
    const clip = makeClip();
    const clones = new Map<string, THREE.AnimationClip>();

    const result = playbackClip(clip, null, 200, clones);

    expect(result).toBe(clip);
  });

  it("returns a cloned clip for a same-clip re-trigger, and crossfading it keeps combined weight at 1", () => {
    const root = new THREE.Object3D();
    const mixer = new THREE.AnimationMixer(root);
    const clip = makeClip();
    const clones = new Map<string, THREE.AnimationClip>();

    const firstClip = playbackClip(clip, null, 200, clones);
    const prevAction = mixer.clipAction(firstClip);
    prevAction.play();
    mixer.update(0.5);

    const nextClip = playbackClip(clip, prevAction.getClip(), 200, clones);

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
    const clones = new Map<string, THREE.AnimationClip>();

    const first = playbackClip(clip, null, 200, clones);
    const second = playbackClip(clip, first, 200, clones);

    expect(second).not.toBe(clip);
  });

  it("keeps one clone per base clip, so an upright clip and its mirror never share one", () => {
    const upright = makeClip();
    const mirrored = upright.clone();
    const clones = new Map<string, THREE.AnimationClip>();

    const uprightClone = playbackClip(upright, upright, 200, clones);
    const mirroredClone = playbackClip(mirrored, mirrored, 200, clones);

    expect(clones.size).toBe(2);
    expect(uprightClone).not.toBe(mirroredClone);
  });

  it("passes the clip through unchanged when fadeMs is 0", () => {
    const clip = makeClip();
    const clones = new Map<string, THREE.AnimationClip>();

    const result = playbackClip(clip, clip, 0, clones);

    expect(result).toBe(clip);
  });

  it("passes the clip through unchanged when the previous clip differs", () => {
    const clip = makeClip();
    const otherClip = makeClip();
    const clones = new Map<string, THREE.AnimationClip>();

    const result = playbackClip(clip, otherClip, 200, clones);

    expect(result).toBe(clip);
  });

  it("reuses the same cloned instance across calls with the same key", () => {
    const clip = makeClip();
    const clones = new Map<string, THREE.AnimationClip>();

    const first = playbackClip(clip, clip, 200, clones);
    const second = playbackClip(clip, clip, 200, clones);

    expect(first).toBe(second);
  });

  it("alternating from the clone back to the original returns the original clip and creates no additional clone", () => {
    const clip = makeClip();
    const clones = new Map<string, THREE.AnimationClip>();

    const cloned = playbackClip(clip, clip, 200, clones);
    expect(cloned).not.toBe(clip);

    // prev is now the clone (a different uuid from the base clip), so the base clip
    // resolves unchanged rather than producing a second clone.
    const result = playbackClip(clip, cloned, 200, clones);

    expect(result).toBe(clip);
    expect(clones.size).toBe(1);
  });
});
