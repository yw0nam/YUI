/**
 * perch-hold.test.ts — pure predicate gating motion requests while a posture is held.
 *
 * The renderer can't be unit-instantiated (real THREE.WebGLRenderer needs a GL
 * context; see index.test.ts). So the held-perch decision is extracted here as a
 * pure predicate and tested directly, then wired into playMotion.
 */

import { describe, expect, it } from "vitest";
import type { MotionKind, MotionSignal } from "../contract";
import { suppressIdleReturn as suppressWhileHeld } from "./perch-hold";

const kinds: Record<string, MotionKind> = {
  happy: "oneshot",
  peek: "state",
  window_sit: "state",
};
const kindOf = (id: string) => kinds[id];

describe("suppressWhileHeld — held postures survive incoming motion cues", () => {
  it("suppresses an implicit idle return (null motion) while perched", () => {
    expect(suppressWhileHeld(null, true, kindOf)).toBe(true);
  });

  it("suppresses an implicit idle return (null motion) while peeking", () => {
    expect(suppressWhileHeld(null, true, kindOf)).toBe(true);
  });

  it("suppresses a non-state motion while perched", () => {
    const happy: MotionSignal = { id: "happy" };
    expect(suppressWhileHeld(happy, true, kindOf)).toBe(true);
  });

  it("suppresses a non-state motion while peeking", () => {
    const happy: MotionSignal = { id: "happy" };
    expect(suppressWhileHeld(happy, true, kindOf)).toBe(true);
  });

  it.each(["peek", "window_sit"])("allows the %s state motion while held", (id) => {
    expect(suppressWhileHeld({ id }, true, kindOf)).toBe(false);
  });

  it.each([null, { id: "happy" }, { id: "peek" }, { id: "missing" }])(
    "allows %j when no posture is held",
    (motion) => {
      expect(suppressWhileHeld(motion, false, kindOf)).toBe(false);
    },
  );

  it("suppresses an unregistered motion while held", () => {
    expect(suppressWhileHeld({ id: "missing" }, true, kindOf)).toBe(true);
  });
});
