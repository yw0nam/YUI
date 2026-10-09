import { describe, expect, it } from "vitest";
import { clampUnderHold, dropUnderHold } from "./motion-hold";

const hold = ["bed_sleep", "bed_wake"];

describe("dropUnderHold — a hold drops requests from outside its ids", () => {
  it.each([null, { id: "wave" }])("drops %j while a hold is set", (motion) => {
    expect(dropUnderHold(motion, hold)).toBe(true);
  });

  it("drops an agent's motion cue while the bed scene holds her lying", () => {
    const lying = ["bed_lie", "bed_sleep", "bed_wake"];
    expect(dropUnderHold({ id: "happy" }, lying)).toBe(true);
    expect(dropUnderHold({ id: "bed_lie" }, lying)).toBe(false);
  });

  it("allows a held id while a hold is set", () => {
    expect(dropUnderHold({ id: "bed_wake" }, hold)).toBe(false);
  });

  it.each([null, { id: "wave" }])("allows %j without a hold", (motion) => {
    expect(dropUnderHold(motion, null)).toBe(false);
  });
});

describe("clampUnderHold — a held motion's finish is not chained", () => {
  it("clamps a held id", () => {
    expect(clampUnderHold("bed_sleep", hold)).toBe(true);
  });

  it("chains an id outside the hold", () => {
    expect(clampUnderHold("wave", hold)).toBe(false);
  });

  it("chains every id without a hold", () => {
    expect(clampUnderHold("bed_sleep", null)).toBe(false);
  });
});
