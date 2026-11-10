import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";
import * as THREE from "three";

export interface SoleBone {
  /** Normalized humanoid bone node. */
  bone: THREE.Object3D;
  /** Sole points in the bone's local frame. */
  points: THREE.Vector3[];
}

const SOLE_BONES = ["leftFoot", "rightFoot", "leftToes", "rightToes"] as const;
/** Height above a bone's lowest rest point that still counts as sole. */
const SOLE_BAND_M = 0.03;
/** Points kept per bone; 8 missed by 1.17 cm on a measured idle, 16 stayed within 0.61 cm. */
const MAX_POINTS = 16;

/** Sole points per foot/toes bone, read from the skinned meshes in the rest pose. */
export function extractSoleBones(vrm: VRM): SoleBone[] {
  vrm.scene.updateMatrixWorld(true);
  const { humanoid } = vrm;
  const rawHumanoid = new Set(Object.values(humanoid.rawHumanBones).map((b) => b?.node));
  const owner = new Map<THREE.Object3D, VRMHumanBoneName>();
  const claim = (node: THREE.Object3D, name: VRMHumanBoneName) => {
    owner.set(node, name);
    for (const child of node.children) if (!rawHumanoid.has(child)) claim(child, name);
  };
  for (const name of SOLE_BONES) {
    const node = humanoid.getRawBoneNode(name);
    if (node) claim(node, name);
  }

  const found = new Map<VRMHumanBoneName, THREE.Vector3[]>();
  vrm.scene.traverse((mesh) => {
    if (!(mesh instanceof THREE.SkinnedMesh)) return;
    const index = mesh.geometry.getAttribute("skinIndex");
    const weight = mesh.geometry.getAttribute("skinWeight");
    if (!index || !weight) return;
    for (let i = 0; i < index.count; i++) {
      let k = 0;
      for (let c = 1; c < weight.itemSize; c++) {
        if (weight.getComponent(i, c) > weight.getComponent(i, k)) k = c;
      }
      const name = owner.get(mesh.skeleton.bones[index.getComponent(i, k)]);
      if (!name) continue;
      const p = mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
      const list = found.get(name) ?? [];
      list.push(p);
      found.set(name, list);
    }
  });

  const soles: SoleBone[] = [];
  for (const name of SOLE_BONES) {
    const all = found.get(name);
    const bone = humanoid.getNormalizedBoneNode(name);
    if (!all || !bone) continue;
    const toLocal = bone.matrixWorld.clone().invert();
    soles.push({ bone, points: farthestPoints(all).map((p) => p.applyMatrix4(toLocal)) });
  }
  return soles;
}

/** The band of points near the lowest one, thinned by farthest-point sampling from the lowest. */
function farthestPoints(all: THREE.Vector3[]): THREE.Vector3[] {
  const lowest = all.reduce((a, b) => (b.y < a.y ? b : a));
  const rest = all.filter((p) => p !== lowest && p.y <= lowest.y + SOLE_BAND_M);
  const picked = [lowest];
  const dist = rest.map((p) => p.distanceToSquared(lowest));
  while (picked.length < MAX_POINTS && rest.length > 0) {
    let far = 0;
    for (let i = 1; i < rest.length; i++) if (dist[i] > dist[far]) far = i;
    const p = rest[far];
    picked.push(p);
    rest.splice(far, 1);
    dist.splice(far, 1);
    for (let i = 0; i < rest.length; i++) dist[i] = Math.min(dist[i], rest[i].distanceToSquared(p));
  }
  return picked;
}
