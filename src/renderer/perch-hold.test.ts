/**
 * perch-hold.test.ts — pure predicate gating motion requests while a posture is held.
 *
 * The renderer can't be unit-instantiated because real THREE.WebGLRenderer needs a GL
 * context. So held-posture decisions are extracted and tested as pure functions.
 */

import { describe, expect, it } from "vitest";
import type { MotionKind, MotionSignal } from "../contract";
import { baselineWhileHeld, suppressWhileHeld } from "./perch-hold";

const kinds: Record<string, MotionKind> = {
  happy: "oneshot",
  peek: "state",
  window_sit: "state",
};
const kindOf = (id: string) => kinds[id];

describe("suppressWhileHeld — held postures survive incoming motion cues", () => {
  it("suppresses an implicit idle return while any posture is held", () => {
    expect(suppressWhileHeld(null, true, kindOf)).toBe(true);
  });

  it("suppresses a non-state motion while any posture is held", () => {
    const happy: MotionSignal = { id: "happy" };
    expect(suppressWhileHeld(happy, true, kindOf)).toBe(true);
  });

  it.each(["peek", "window_sit"])("allows the %s state motion while held", (id) => {
    expect(suppressWhileHeld({ id }, true, kindOf)).toBe(false);
  });

  it.each([
    null,
    { id: "happy" },
    { id: "peek" },
    { id: "missing" },
  ])("allows %j when no posture is held", (motion) => {
    expect(suppressWhileHeld(motion, false, kindOf)).toBe(false);
  });

  it("suppresses an unregistered motion while held", () => {
    expect(suppressWhileHeld({ id: "missing" }, true, kindOf)).toBe(true);
  });
});

describe("baselineWhileHeld — VRM reload restores held state motion", () => {
  it("uses the last state motion while a posture is held", () => {
    expect(baselineWhileHeld(true, "window_sit", "idle")).toBe("window_sit");
  });

  it("uses the baseline without a remembered state motion", () => {
    expect(baselineWhileHeld(true, null, "idle")).toBe("idle");
  });

  it("uses the baseline when no posture is held", () => {
    expect(baselineWhileHeld(false, "window_sit", "idle")).toBe("idle");
  });
});
