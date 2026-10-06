/**
 * session.test.ts — validates runtime narrowing of the Usage type.
 *
 * The type itself is subject to compile-time checks (pnpm build) as the primary gate, but this test
 * fixes the value-level assertion that field access is possible at runtime.
 */

import { describe, expect, expectTypeOf, it } from "vitest";
import type { Usage } from "./types";

describe("Usage", () => {
  it("carries the response.completed usage shape (input/output/total)", () => {
    const usage: Usage = { input_tokens: 120, output_tokens: 30, total_tokens: 150 };
    expect(usage.total_tokens).toBe(usage.input_tokens + usage.output_tokens);
    expectTypeOf<Usage["input_tokens"]>().toEqualTypeOf<number>();
  });
});
