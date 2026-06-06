/**
 * describe-expressions.test.ts — TDD red for describeExpressions helper (#observability).
 *
 * Pins the contract for a pure helper that inspects an expressionManager's
 * expressionMap and reports which expressions exist and whether the mouth key ("aa")
 * is present. Useful for answering "audio played but the mouth didn't move — why?"
 * from logs.
 */

import { describe, it, expect } from "vitest";
import { describeExpressions, MOUTH_EXPRESSION_KEY } from "./index";

describe("describeExpressions — MOUTH_EXPRESSION_KEY", () => {
  it("is 'aa'", () => {
    expect(MOUTH_EXPRESSION_KEY).toBe("aa");
  });
});

describe("describeExpressions — with expressionMap containing 'aa'", () => {
  it("returns all expression names and hasMouth:true", () => {
    const em = { expressionMap: { aa: {}, blink: {}, happy: {} } };
    const result = describeExpressions(em);
    expect(result.expressions).toEqual(expect.arrayContaining(["aa", "blink", "happy"]));
    expect(result.expressions).toHaveLength(3);
    expect(result.hasMouth).toBe(true);
  });
});

describe("describeExpressions — expressionMap without 'aa'", () => {
  it("returns hasMouth:false", () => {
    const em = { expressionMap: { a: {}, i: {} } };
    const result = describeExpressions(em);
    expect(result.expressions).toEqual(expect.arrayContaining(["a", "i"]));
    expect(result.hasMouth).toBe(false);
  });
});

describe("describeExpressions — null/undefined input", () => {
  it("returns empty expressions and hasMouth:false for null", () => {
    const result = describeExpressions(null);
    expect(result.expressions).toEqual([]);
    expect(result.hasMouth).toBe(false);
  });

  it("returns empty expressions and hasMouth:false for undefined", () => {
    const result = describeExpressions(undefined);
    expect(result.expressions).toEqual([]);
    expect(result.hasMouth).toBe(false);
  });

  it("returns empty expressions and hasMouth:false when expressionMap is absent", () => {
    const result = describeExpressions({});
    expect(result.expressions).toEqual([]);
    expect(result.hasMouth).toBe(false);
  });
});
