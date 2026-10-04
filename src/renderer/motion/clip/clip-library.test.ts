import type { VRM } from "@pixiv/three-vrm";
import * as THREE from "three";
import type { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { describe, expect, it, vi } from "vitest";
import { createClipLibrary } from "./clip-library";

vi.mock("@pixiv/three-vrm-animation", () => ({
  createVRMAnimationClip: () => new THREE.AnimationClip("clip", 1, []),
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
