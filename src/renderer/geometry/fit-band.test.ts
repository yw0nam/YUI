/**
 * Pins the height-bound band fit with hand-computed literals:
 *   band 0.4..1 of a 1.6 box spans y 0.64..1.6, centre 1.12, half height 0.48
 *   distance = 0.48 / tan(15°) · (1 + margin), tan(15°) = 0.2679491924311227
 */

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { computeBandFit } from "./fit-band";

const BOX = new THREE.Box3(new THREE.Vector3(-0.3, 0, -0.2), new THREE.Vector3(0.3, 1.6, 0.2));
const BAND = { from_frac: 0.4, to_frac: 1 };

describe("computeBandFit", () => {
  it("frames the band by its height with the target at its centre", () => {
    const fit = computeBandFit(BOX, BAND, { fov: 30, margin: 0 });
    expect(fit).not.toBeNull();
    expect(fit?.target.x).toBeCloseTo(0, 6);
    expect(fit?.target.y).toBeCloseTo(1.12, 6);
    expect(fit?.target.z).toBeCloseTo(0, 6);
    expect(fit?.distance).toBeCloseTo(1.79138, 4);
  });

  it("scales the distance by the margin and keeps the target", () => {
    const fit = computeBandFit(BOX, BAND, { fov: 30, margin: 0.1 });
    expect(fit?.distance).toBeCloseTo(1.97052, 4);
    expect(fit?.target.y).toBeCloseTo(1.12, 6);
  });

  it("returns null for an empty box", () => {
    expect(computeBandFit(new THREE.Box3(), BAND, { fov: 30, margin: 0 })).toBeNull();
  });
});
