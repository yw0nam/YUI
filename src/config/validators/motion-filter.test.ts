import { describe, expect, it } from "vitest";
import { validateMotionFilter } from "./motion-filter";
import { ConfigError } from "./shared";

const FILE = "motion-filter.json";

describe("validateMotionFilter", () => {
  it("accepts string blocked_tags", () => {
    expect(validateMotionFilter(FILE, { blocked_tags: ["energetic", "playful"] })).toEqual({
      blocked_tags: ["energetic", "playful"],
    });
  });

  it("defaults a missing blocked_tags key to an empty array", () => {
    expect(validateMotionFilter(FILE, {})).toEqual({ blocked_tags: [] });
  });

  it("rejects blocked_tags that are not an array", () => {
    expect(() => validateMotionFilter(FILE, { blocked_tags: "energetic" })).toThrow(ConfigError);
  });

  it("rejects blocked_tags containing non-string values", () => {
    expect(() => validateMotionFilter(FILE, { blocked_tags: ["energetic", 1] })).toThrow(
      ConfigError,
    );
  });
});
