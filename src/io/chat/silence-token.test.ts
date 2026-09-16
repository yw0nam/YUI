/**
 * silence-token.test.ts — stateful `[SILENT]` token filter for spoken output_text deltas.
 *
 * Scope: holds back a stream until it can tell whether the whole reply is (whitespace
 * around) exactly `[SILENT]` — the backend's deliberate-silence token — and swallows it
 * when it is. A `[SILENT]` inside a longer reply, and everything after divergence,
 * passes through untouched. Whitespace-only replies flush to empty.
 */

import { describe, expect, it } from "vitest";
import { createSilenceTokenFilter, isSilenceToken } from "./silence-token";

describe("createSilenceTokenFilter — token split across deltas", () => {
  it("swallows a [SILENT] token split across deltas with leading whitespace", () => {
    const f = createSilenceTokenFilter();
    expect(f.push("\n\n")).toBe("");
    expect(f.push("[SIL")).toBe("");
    expect(f.push("ENT]")).toBe("");
    expect(f.flush()).toBe("");
  });

  it("releases the full text when the token turns out to be a reply prefix", () => {
    const f = createSilenceTokenFilter();
    expect(f.push("[SIL")).toBe("");
    expect(f.push("ENT] is what I would say")).toBe("[SILENT] is what I would say");
    expect(f.push(" more")).toBe(" more");
    expect(f.flush()).toBe("");
  });
});

describe("createSilenceTokenFilter — surrounding whitespace", () => {
  it("swallows a token padded with whitespace in a single delta", () => {
    const f = createSilenceTokenFilter();
    expect(f.push("  [SILENT]  \n")).toBe("");
    expect(f.flush()).toBe("");
  });

  it("passes through text that merely contains the token", () => {
    const f = createSilenceTokenFilter();
    expect(f.push("Hi [SILENT]")).toBe("Hi [SILENT]");
  });
});

describe("createSilenceTokenFilter — flush", () => {
  it("flush returns a held partial prefix as-is", () => {
    const f = createSilenceTokenFilter();
    expect(f.push("[SIL")).toBe("");
    expect(f.flush()).toBe("[SIL");
  });

  it("flush collapses a whitespace-only response to empty", () => {
    const f = createSilenceTokenFilter();
    expect(f.push("   ")).toBe("");
    expect(f.flush()).toBe("");
  });
});

describe("isSilenceToken", () => {
  it("true for the bare token with optional surrounding whitespace", () => {
    expect(isSilenceToken("[SILENT]")).toBe(true);
    expect(isSilenceToken("  [SILENT]  ")).toBe(true);
  });

  it("false for undefined, empty, or non-token text", () => {
    expect(isSilenceToken(undefined)).toBe(false);
    expect(isSilenceToken("")).toBe(false);
    expect(isSilenceToken("Hi [SILENT]")).toBe(false);
  });
});
