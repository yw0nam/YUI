import type { VRM } from "@pixiv/three-vrm";
import * as THREE from "three";
import type { SoleBone } from "./sole-points";

const _p = new THREE.Vector3();

/** Signed Y (metres) that puts the lowest sole point on vrm.scene's floor (Y = 0 in vrm.scene's parent frame). */
export function soleOffset(vrm: VRM, soles: readonly SoleBone[]): number {
  if (soles.length === 0) return 0;
  // The mixer has just written the normalized bones; without this the points lag one frame.
  vrm.humanoid.normalizedHumanBonesRoot.updateMatrixWorld(true);
  let lowest = Number.POSITIVE_INFINITY;
  for (const { bone, points } of soles) {
    for (const p of points) lowest = Math.min(lowest, _p.copy(p).applyMatrix4(bone.matrixWorld).y);
  }
  // The normalized bones inherit vrm.scene's matrixWorld, so its Y cancels out.
  return vrm.scene.matrixWorld.elements[13] - lowest;
}
