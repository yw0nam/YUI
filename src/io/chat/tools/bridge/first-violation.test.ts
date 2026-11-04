/**
 * first-violation.test.ts — the first JSON Schema violation of a plugin tool's arguments.
 */

import { describe, expect, it } from "vitest";
import { firstViolation } from "./first-violation";

describe("firstViolation", () => {
  it("names the property that broke the schema", () => {
    const schema = { type: "object", properties: { days: { type: "integer", maximum: 7 } } };

    expect(firstViolation(schema, { days: 9 })).toBe("#/days: 9 is greater than 7.");
  });

  it("names a missing required property", () => {
    const schema = {
      type: "object",
      properties: { location: { type: "string" } },
      required: ["location"],
    };

    expect(firstViolation(schema, {})).toBe(
      '#: Instance does not have required property "location".',
    );
  });

  it("names an extra property", () => {
    const schema = {
      type: "object",
      properties: { a: { type: "string" } },
      additionalProperties: false,
    };

    expect(firstViolation(schema, { a: "x", extra: 1 })).toBe(
      '#: Property "extra" does not match additional properties schema.',
    );
  });

  it("returns null for a conforming value", () => {
    const schema = { type: "object", properties: { days: { type: "integer", maximum: 7 } } };

    expect(firstViolation(schema, { days: 3 })).toBeNull();
  });
});
