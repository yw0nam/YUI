import { describe, expect, it } from "vitest";
import { readStance } from "./stance";

const PRESETS = [
  { id: "default", name: "yui" },
  { id: "aaaa0001", name: "perlica" },
  { id: "bbbb0002", name: "shino" },
  { id: "cccc0003", name: "rin" },
  { id: "dddd0004", name: "user" },
];

describe("readStance", () => {
  it("lists user first, then the other rated presets in registry order, by name", () => {
    const relations = {
      cccc0003: { value: -6, updated_at: 9, log: [{ at: 8, delta: -2, why: "took the chair" }] },
      user: { value: 5, updated_at: 7, log: [{ at: 7, delta: 1, why: "stayed up" }] },
      default: { value: 4, updated_at: 6, log: [{ at: 6, delta: 2, why: "self" }] },
      aaaa0001: { value: 0, updated_at: 5, log: [], note: "trusts the work" },
    };

    expect(readStance(relations, "default", PRESETS)).toEqual([
      { target: "user", band: "warm", delta: 1, why: "stayed up", at: 7 },
      { target: "perlica", band: "neutral", delta: 0, why: "", at: 5, note: "trusts the work" },
      { target: "rin", band: "cold", delta: -2, why: "took the chair", at: 8 },
    ]);
  });

  it("labels a preset named user as user (character), the bare user staying the human", () => {
    const relations = {
      dddd0004: { value: 2, updated_at: 9, log: [{ at: 9, delta: 2, why: "said hi" }] },
    };

    expect(readStance(relations, "default", PRESETS)).toEqual([
      { target: "user (character)", band: "neutral", delta: 2, why: "said hi", at: 9 },
    ]);
  });
});
