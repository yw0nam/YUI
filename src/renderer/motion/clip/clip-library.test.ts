import type { VRM } from "@pixiv/three-vrm";
import * as THREE from "three";
import type { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { describe, expect, it, vi } from "vitest";
import { createClipLibrary } from "./clip-library";

vi.mock("@pixiv/three-vrm-animation", () => ({
  // One hips.position track whose X/Z mean is not zero (mean X = 2), so the
  // default recentring has something to move and root_keep_xz has something to keep.
  createVRMAnimationClip: () =>
    new THREE.AnimationClip("clip", 1, [
      new THREE.VectorKeyframeTrack("hips.position", [0, 1], [1, 2, 0, 3, 4, 0]),
    ]),
}));

function makeVrm(): VRM {
  return {
    scene: new THREE.Object3D(),
    humanoid: { getNormalizedBoneNode: () => null },
  } as unknown as VRM;
}

function makeLibrary() {
  const loader = { loadAsync: vi.fn() };
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const clips = createClipLibrary({
    loader: loader as unknown as Pick<GLTFLoader, "loadAsync">,
    getRegistry: () => ({}),
    log,
  });
  return { clips, loader };
}

describe("clip-library", () => {
  it("cache hit calls the loader once", async () => {
    const { clips, loader } = makeLibrary();
    loader.loadAsync.mockResolvedValue({ userData: { vrmAnimations: [{}] } });
    clips.onVrmLoaded(makeVrm());

    const first = await clips.load("a.vrma");
    const second = await clips.load("a.vrma");

    expect(loader.loadAsync).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("a failed load is never refetched", async () => {
    const { clips, loader } = makeLibrary();
    loader.loadAsync.mockRejectedValue(new Error("404"));
    clips.onVrmLoaded(makeVrm());

    expect(await clips.load("a.vrma")).toBeNull();
    expect(await clips.load("a.vrma")).toBeNull();
    expect(loader.loadAsync).toHaveBeenCalledTimes(1);
  });

  it("root_keep_xz keeps the authored hips X/Z; the default recentres from a second cache entry", async () => {
    const { clips, loader } = makeLibrary();
    loader.loadAsync.mockResolvedValue({ userData: { vrmAnimations: [{}] } });
    clips.onVrmLoaded(makeVrm());

    const kept = await clips.load("a.vrma", false, true);
    const recentred = await clips.load("a.vrma", false, false);

    // Two cache keys → both loads call the loader.
    expect(loader.loadAsync).toHaveBeenCalledTimes(2);
    expect(kept!.tracks[0]!.values).toEqual(new Float32Array([1, 2, 0, 3, 4, 0]));
    // X/Z centred on their own mean (2 / 0), Y kept.
    expect(recentred!.tracks[0]!.values).toEqual(new Float32Array([-1, 2, 0, 1, 4, 0]));
  });

  it("a load overtaken by a VRM swap returns null", async () => {
    const { clips, loader } = makeLibrary();
    let resolveLoad!: (value: unknown) => void;
    loader.loadAsync.mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve;
      }),
    );
    clips.onVrmLoaded(makeVrm());

    const pending = clips.load("a.vrma");
    clips.onVrmDisposed();
    clips.onVrmLoaded(makeVrm());
    resolveLoad({ userData: { vrmAnimations: [{}] } });

    expect(await pending).toBeNull();
  });
});
