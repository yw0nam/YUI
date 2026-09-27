import type { VRM } from "@pixiv/three-vrm";

/**
 * Sign that turns a downward head pitch into a normalized bone's local rotation.x.
 * VRM 0.x faces -Z natively and rotateVRM0 only turns the scene root, so its sign flips.
 */
export function downPitchSign(vrm: VRM): 1 | -1 {
  return vrm.meta?.metaVersion === "0" ? -1 : 1;
}
