import type { VRM } from "@pixiv/three-vrm";
import type * as THREE from "three";

export interface SoleBone {
  /** Normalized humanoid bone node. */
  bone: THREE.Object3D;
  /** Sole points in the bone's local frame. */
  points: THREE.Vector3[];
}

export function extractSoleBones(_vrm: VRM): SoleBone[] {
  return [];
}
