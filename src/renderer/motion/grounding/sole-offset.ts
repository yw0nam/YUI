import type { VRM } from "@pixiv/three-vrm";
import type { SoleBone } from "./sole-points";

/** Signed Y (metres) that puts the lowest sole point on vrm.scene's floor (Y = 0 in vrm.scene's parent frame). */
export function soleOffset(_vrm: VRM, _soles: readonly SoleBone[]): number {
  return 0;
}
