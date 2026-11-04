/** VRM load helpers: the three-vrm optimisation of a loaded glTF and the display-name read. */

import { type VRM, VRMExpression, VRMUtils } from "@pixiv/three-vrm";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";

/** Optimises a loaded glTF (three-vrm official recommendation) and returns its VRM. */
export function prepareVrm(gltf: GLTF): VRM {
  const vrm = gltf.userData.vrm as VRM;
  promoteVrm0ExpressionPresets(vrm);
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

// A VRM 0.x custom expression named after a preset (lowercased) loads as that preset when the preset is empty.
const TO_PRESET: ReadonlyMap<string, string> = new Map([
  ["neutral", "neutral"],
  ["a", "aa"],
  ["i", "ih"],
  ["u", "ou"],
  ["e", "ee"],
  ["o", "oh"],
  ["blink", "blink"],
  ["blink_l", "blinkLeft"],
  ["blink_r", "blinkRight"],
  ["joy", "happy"],
  ["angry", "angry"],
  ["sorrow", "sad"],
  ["fun", "relaxed"],
  ["surprised", "surprised"],
  ["lookup", "lookUp"],
  ["lookdown", "lookDown"],
  ["lookleft", "lookLeft"],
  ["lookright", "lookRight"],
]);

function promoteVrm0ExpressionPresets(vrm: VRM): void {
  const manager = vrm.expressionManager;
  if (vrm.meta?.metaVersion !== "0" || manager == null) return;
  for (const expression of Object.values(manager.customExpressionMap)) {
    const target = TO_PRESET.get(expression.expressionName.toLowerCase());
    if (target == null || manager.getExpression(target) != null) continue;
    const promoted = new VRMExpression(target);
    promoted.isBinary = expression.isBinary;
    promoted.overrideBlink = expression.overrideBlink;
    promoted.overrideLookAt = expression.overrideLookAt;
    promoted.overrideMouth = expression.overrideMouth;
    promoted.weight = expression.weight;
    for (const bind of expression.binds) promoted.addBind(bind);
    expression.parent?.add(promoted);
    expression.removeFromParent();
    manager.unregisterExpression(expression);
    manager.registerExpression(promoted);
  }
}
