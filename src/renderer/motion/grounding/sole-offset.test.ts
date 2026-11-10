import { type VRM, type VRMHumanBones, VRMHumanoid } from "@pixiv/three-vrm";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { soleOffset } from "./sole-offset";
import { extractSoleBones } from "./sole-points";

/** A left leg with a non-humanoid SmallToe under leftToes and a non-humanoid chain under leftUpperLeg. */
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
    [chain, 0.15, -0.02, 0],
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

const round = (n: number) => Math.round(n * 1e6) / 1e6 + 0;

describe("sole grounding", () => {
  it("keeps the foot, toes and SmallToe points and drops the chain point", () => {
    const soles = extractSoleBones(makeVrm()).map(({ bone, points }) => ({
      bone: bone.name,
      points: points.map((p) => p.clone().applyMatrix4(bone.matrixWorld).toArray().map(round)),
    }));
    expect(soles).toEqual([
      {
        bone: "Normalized_leftFoot",
        points: [
          [0.1, 0, -0.05],
          [0.1, 0.002, 0.08],
        ],
      },
      {
        bone: "Normalized_leftToes",
        points: [
          [0.1, 0, 0.17],
          [0.1, 0.005, 0.14],
        ],
      },
    ]);
  });

  it.each([0, 0.3])("puts the lowest posed sole on the floor with the scene at y=%s", (sceneY) => {
    const vrm = makeVrm();
    const soles = extractSoleBones(vrm);
    vrm.scene.position.y = sceneY;
    vrm.scene.updateMatrixWorld(true);
    // Toes down 30°: the SmallToe point, 0.1 below and 0.17 ahead of the ankle at y=0.1, goes lowest.
    vrm.humanoid.getNormalizedBoneNode("leftFoot")!.rotation.x = Math.PI / 6;
    expect(soleOffset(vrm, soles)).toBeCloseTo(0.0716025, 6);
  });
});
