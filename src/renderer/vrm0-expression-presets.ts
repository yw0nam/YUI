/** Promotes a VRM 0.x model's custom expressions named after presets to those presets; delete when a three-vrm release carries the upstream PR. */

import { type VRM, VRMExpression } from "@pixiv/three-vrm";

// UniVRM MigrationVrmExpression.ToPreset: lowercase custom name → 1.0 preset.
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

export function promoteVrm0ExpressionPresets(vrm: VRM): void {
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
