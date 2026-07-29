import { describe, expect, it } from "vitest";
import { isSafeSanitizedId } from "./safe-id";

describe("isSafeSanitizedId", () => {
  it("accepts a plain ASCII id", () => {
    expect(isSafeSanitizedId("My_Avatar-1")).toBe(true);
  });

  it("accepts UTF-8 ids (matches the relaxed native sanitize_stem)", () => {
    expect(isSafeSanitizedId("ナツメ")).toBe(true);
    expect(isSafeSanitizedId("무라사메")).toBe(true);
  });

  it("accepts an interior dot (only leading/trailing dots are traversal-relevant)", () => {
    expect(isSafeSanitizedId("a.b")).toBe(true);
  });

  it("rejects an empty id", () => {
    expect(isSafeSanitizedId("")).toBe(false);
  });

  it("rejects '.' and '..'", () => {
    expect(isSafeSanitizedId(".")).toBe(false);
    expect(isSafeSanitizedId("..")).toBe(false);
  });

  it("rejects a leading or trailing dot", () => {
    expect(isSafeSanitizedId(".hidden")).toBe(false);
    expect(isSafeSanitizedId("hidden.")).toBe(false);
  });

  it("rejects a leading or trailing whitespace", () => {
    expect(isSafeSanitizedId(" x")).toBe(false);
    expect(isSafeSanitizedId("x ")).toBe(false);
  });

  it("rejects path separators", () => {
    expect(isSafeSanitizedId("a/b")).toBe(false);
    expect(isSafeSanitizedId("a\\b")).toBe(false);
  });

  it("rejects ASCII control chars and NUL", () => {
    expect(isSafeSanitizedId("a\0b")).toBe(false);
    expect(isSafeSanitizedId("a\tb")).toBe(false);
  });

  it("rejects Windows-illegal characters", () => {
    for (const bad of ['a<b', 'a>b', 'a:b', 'a"b', "a|b", "a?b", "a*b"]) {
      expect(isSafeSanitizedId(bad)).toBe(false);
    }
  });
});
