import { describe, expect, it } from "vitest";
import { avatarFixture } from "../../config/load-test-helpers";
import { pickEntry } from "./entry-pick";

const families = avatarFixture().stage.entry_families;

describe("pickEntry", () => {
  it.each([
    ["happy", "glad", "excited"],
    ["surprised", "glad", "excited"],
    ["thinking", "plain", "wave_3"],
    ["embarrassed", "glum", "yawn"],
    ["bored", "plain", "wave_3"],
  ])("picks %s's entry from the %s family", (emotion, family, clip) => {
    expect(pickEntry(families, emotion, new Map(), () => 0)).toEqual({ family, clip });
  });

  it.each([
    [0, "bow"],
    [0.99, "peek"],
  ])("never picks the family's last clip again (draw %d picks %s)", (draw, clip) => {
    const last = new Map([["plain", "wave_3"]]);

    expect(pickEntry(families, "neutral", last, () => draw)).toEqual({ family: "plain", clip });
  });

  it("repeats a family's only clip", () => {
    const one = { plain: { emotions: ["neutral"], clips: ["calm"] } };

    expect(pickEntry(one, "neutral", new Map([["plain", "calm"]]), () => 0)).toEqual({
      family: "plain",
      clip: "calm",
    });
  });
});
