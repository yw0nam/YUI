import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { mirrorClipTracks } from "./mirror-clip";

describe("mirrorClipTracks", () => {
  it("swaps mapped node names in both directions from one snapshot", () => {
    const clip = new THREE.AnimationClip("peek", 1, [
      new THREE.QuaternionKeyframeTrack("leftArm.quaternion", [0], [1, 2, 3, 4]),
      new THREE.QuaternionKeyframeTrack("rightArm.quaternion", [0], [5, 6, 7, 8]),
    ]);

    const mirrored = mirrorClipTracks(
      clip,
      new Map([
        ["leftArm", "rightArm"],
        ["rightArm", "leftArm"],
      ]),
    );

    expect(mirrored.tracks.map((track) => track.name)).toEqual([
      "rightArm.quaternion",
      "leftArm.quaternion",
    ]);
  });

  it("mirrors quaternion and position values while preserving other components", () => {
    const clip = new THREE.AnimationClip("peek", 1, [
      new THREE.QuaternionKeyframeTrack("hips.quaternion", [0, 1], [1, 2, 3, 4, 5, 6, 7, 8]),
      new THREE.VectorKeyframeTrack("hips.position", [0, 1], [1, 2, 3, 4, 5, 6]),
    ]);

    const mirrored = mirrorClipTracks(clip, new Map());

    expect(Array.from(mirrored.tracks[0].values)).toEqual([1, -2, -3, 4, 5, -6, -7, 8]);
    expect(Array.from(mirrored.tracks[1].values)).toEqual([-1, 2, 3, -4, 5, 6]);
  });

  it("leaves unmapped names and unsupported track properties untouched", () => {
    const clip = new THREE.AnimationClip("peek", 1, [
      new THREE.NumberKeyframeTrack("blink.weight", [0, 1], [0.25, 0.75]),
      new THREE.VectorKeyframeTrack("unmapped.scale", [0], [1, 2, 3]),
    ]);

    const mirrored = mirrorClipTracks(clip, new Map([["leftArm", "rightArm"]]));

    expect(mirrored.tracks.map((track) => track.name)).toEqual(["blink.weight", "unmapped.scale"]);
    expect(Array.from(mirrored.tracks[0].values)).toEqual([0.25, 0.75]);
    expect(Array.from(mirrored.tracks[1].values)).toEqual([1, 2, 3]);
  });

  it("does not mutate the input clip", () => {
    const track = new THREE.VectorKeyframeTrack("leftArm.position", [0], [1, 2, 3]);
    const clip = new THREE.AnimationClip("peek", 1, [track]);

    const mirrored = mirrorClipTracks(
      clip,
      new Map([
        ["leftArm", "rightArm"],
        ["rightArm", "leftArm"],
      ]),
    );

    expect(mirrored).not.toBe(clip);
    expect(clip.tracks[0].name).toBe("leftArm.position");
    expect(Array.from(clip.tracks[0].values)).toEqual([1, 2, 3]);
  });
});
