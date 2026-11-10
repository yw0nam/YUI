import { type VRM, type VRMHumanBones, VRMHumanoid } from "@pixiv/three-vrm";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { createGrounding } from "./grounding";

/** A left leg with a non-humanoid SmallToe under leftToes and a non-humanoid chain under leftUpperLeg, lowest in rest. */
function makeVrm(): VRM {
  const scene = new THREE.Object3D();
  const bone = (name: string, parent: THREE.Object3D, x: number, y: number, z: number) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    parent.add(b);
    return b;
  };
  const hips = bone("hips", scene, 0, 1, 0);
  const upperLeg = bone("leftUpperLeg", hips, 0.1, -0.1, 0);
  const lowerLeg = bone("leftLowerLeg", upperLeg, 0, -0.4, 0);
  const foot = bone("leftFoot", lowerLeg, 0, -0.4, 0);
  const toes = bone("leftToes", foot, 0, -0.08, 0.1);
  const smallToe = bone("SmallToe", toes, 0, -0.01, 0.05);
  const chain = bone("chain", upperLeg, 0.05, -0.6, 0);
  scene.updateMatrixWorld(true);

  // World rest positions, each vertex fully weighted to one bone.
  const verts: [THREE.Bone, number, number, number][] = [
    [foot, 0.1, 0, -0.05],
    [foot, 0.1, 0.002, 0.08],
    [foot, 0.1, 0.1, 0],
    [toes, 0.1, 0.005, 0.14],
    [smallToe, 0.1, 0, 0.17],
    [chain, 0.15, -0.2, 0],
  ];
  const bones = [hips, upperLeg, lowerLeg, foot, toes, smallToe, chain];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      verts.flatMap(([, x, y, z]) => [x, y, z]),
      3,
    ),
  );
  geometry.setAttribute(
    "skinIndex",
    new THREE.Uint16BufferAttribute(
      verts.flatMap(([b]) => [bones.indexOf(b), 0, 0, 0]),
      4,
    ),
  );
  geometry.setAttribute(
    "skinWeight",
    new THREE.Float32BufferAttribute(
      verts.flatMap(() => [1, 0, 0, 0]),
      4,
    ),
  );
  const mesh = new THREE.SkinnedMesh(geometry);
  scene.add(mesh);
  scene.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));

  const humanoid = new VRMHumanoid({
    hips: { node: hips },
    leftUpperLeg: { node: upperLeg },
    leftLowerLeg: { node: lowerLeg },
    leftFoot: { node: foot },
    leftToes: { node: toes },
  } as unknown as VRMHumanBones);
  scene.add(humanoid.normalizedHumanBonesRoot);
  scene.updateMatrixWorld(true);
  return { scene, humanoid } as unknown as VRM;
}

describe("createGrounding", () => {
  // Foot rest: ankle at y=0.1; heel 0.1 below it and 0.05 back; SmallToe 0.1 below and 0.17 ahead.
  it.each([
    // Toes down 30°: the SmallToe point goes lowest, 0.0716025 below the floor.
    ["a grounded pose lifts the lowest sole onto the floor", Math.PI / 6, 0, 1, 0, 0, 0.0716025],
    ["the offset ignores the scene Y written last frame", Math.PI / 6, 0, 1, 0, 0.3, 0.0716025],
    ["weight 0 leaves the perch offset alone", Math.PI / 6, 0, 0, 0.2, 0, 0.2],
    ["a half weight adds half the offset to the perch", Math.PI / 6, 0, 0.5, 0.1, 0, 0.1358013],
    // Only the toes down 30°: SmallToe follows leftToes to 0.0323205 below the floor.
    ["a non-humanoid toe bone follows its toes bone", 0, Math.PI / 6, 1, 0, 0, 0.0323205],
    // Foot flipped: the instep vertex 0.1 above the sole band sits at 0.1, the toe tip lowest at 0.195.
    [
      "a vertex above the sole band never grounds, and a floating sole is lowered",
      Math.PI,
      0,
      1,
      0,
      0,
      -0.195,
    ],
  ])("%s", (_title, footPitch, toesPitch, weight, perch, lastSceneY, expected) => {
    const vrm = makeVrm();
    const grounding = createGrounding({
      groundedWeight: () => weight,
      perchOffsetY: () => perch,
      log: { debug: vi.fn() },
    });
    grounding.onVrmLoaded?.(vrm);
    vrm.humanoid.getNormalizedBoneNode("leftFoot")!.rotation.x = footPitch;
    vrm.humanoid.getNormalizedBoneNode("leftToes")!.rotation.x = toesPitch;
    // Written after the last matrix update, as the previous frame's write is.
    vrm.scene.position.y = lastSceneY;
    grounding.step({ vrm, dt: 1 / 30, elapsed: 0 });
    expect(vrm.scene.position.y).toBeCloseTo(expected, 6);
  });
});
