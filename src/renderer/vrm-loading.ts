/** VRM load helpers: the three-vrm optimisation of a loaded glTF and the display-name read. */

import { type VRM, VRMUtils } from "@pixiv/three-vrm";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";

/** Optimises a loaded glTF (three-vrm official recommendation) and returns its VRM. */
export function prepareVrm(gltf: GLTF): VRM {
  const vrm = gltf.userData.vrm as VRM;
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);
  VRMUtils.combineMorphs(vrm);
  vrm.scene.traverse((obj) => {
    obj.frustumCulled = false;
  });
  VRMUtils.rotateVRM0(vrm); // If VRM0.0, rotate to +Z front; VRM1.0 is no-op.
  return vrm;
}

// Read display name from VRM meta — VRM1.0 uses meta.name, VRM0.0 uses meta.title. null if neither.
export function readVrmMetaName(vrm: VRM): string | null {
  const meta = vrm.meta as { name?: unknown; title?: unknown } | undefined;
  const raw = typeof meta?.name === "string" ? meta.name : meta?.title;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
