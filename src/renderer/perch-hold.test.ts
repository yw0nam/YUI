/**
 * perch-hold.test.ts — pure predicate gating implicit idle return while perched.
 *
 * The renderer can't be unit-instantiated (real THREE.WebGLRenderer needs a GL
 * context; see index.test.ts). So the held-perch decision is extracted here as a
 * pure predicate and tested directly, then wired into playMotion.
 */

import { describe, it, expect } from "vitest";
import type { MotionSignal } from "../contract";
import { suppressIdleReturn } from "./perch-hold";

describe("suppressIdleReturn — held perch survives emotion-only idle returns", () => {
  it("suppresses an implicit idle return (null motion) while perched", () => {
    expect(suppressIdleReturn(null, true)).toBe(true);
  });

  it("allows an implicit idle return (null motion) when not perched", () => {
    expect(suppressIdleReturn(null, false)).toBe(false);
  });

  it("never suppresses an explicit motion while perched", () => {
    const happy: MotionSignal = { id: "happy" };
    expect(suppressIdleReturn(happy, true)).toBe(false);
  });

  it("never suppresses the perch motion itself while perched", () => {
    const windowSit: MotionSignal = { id: "window_sit" };
    expect(suppressIdleReturn(windowSit, true)).toBe(false);
  });
});
