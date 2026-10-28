/** The first JSON Schema violation of value against schema as `<instance location>: <message>`, or null when it conforms. */

import { type Schema, type ValidationResult, Validator } from "@cfworker/json-schema";

/** The keywords that only wrap a deeper error that follows them. */
const WRAPPING = new Set(["properties", "items", "prefixItems", "$ref", "allOf"]);

export function firstViolation(schema: Record<string, unknown>, value: unknown): string | null {
  let result: ValidationResult;
  try {
    result = new Validator(schema as Schema, "2020-12", true).validate(value);
  } catch {
    // An unusable schema is the server's to judge.
    return null;
  }
  if (result.valid) return null;
  const error = result.errors.find((unit) => !WRAPPING.has(unit.keyword)) ?? result.errors[0];
  if (!error) return null;
  return `${error.instanceLocation}: ${error.error}`;
}
