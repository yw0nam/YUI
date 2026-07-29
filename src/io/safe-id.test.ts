import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isSafeSanitizedId, sanitizeStem } from "./safe-id";

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
    for (const bad of ["a<b", "a>b", "a:b", 'a"b', "a|b", "a?b", "a*b"]) {
      expect(isSafeSanitizedId(bad)).toBe(false);
    }
  });

  // Regression: a reserved Windows device name or an all-underscore string is not what
  // sanitize_stem would ever actually PRODUCE (it collapses both to "avatar"), so trusting it
  // as-is from storage let remove_user_voice's sanitize_stem(id) re-derivation resolve to a
  // different, shared "avatar" directory than the one the id claimed to name.
  describe("rejects ids sanitize_stem would never produce (drift regression)", () => {
    it("rejects a bare reserved Windows device name", () => {
      expect(isSafeSanitizedId("CON")).toBe(false);
      expect(isSafeSanitizedId("con")).toBe(false);
      expect(isSafeSanitizedId("COM0")).toBe(false);
      expect(isSafeSanitizedId("LPT0")).toBe(false);
    });

    it("accepts COM10/LPT10 — not reserved", () => {
      expect(isSafeSanitizedId("COM10")).toBe(true);
      expect(isSafeSanitizedId("LPT10")).toBe(true);
    });

    it("rejects an all-underscore id", () => {
      expect(isSafeSanitizedId("___")).toBe(false);
    });

    it("rejects an id longer than sanitize_stem's byte cap", () => {
      expect(isSafeSanitizedId("a".repeat(151))).toBe(false);
      expect(isSafeSanitizedId("a".repeat(150))).toBe(true);
    });
  });
});

describe("sanitizeStem — shared cross-language fixture", () => {
  const fixturePath = fileURLToPath(
    new URL("../../fixtures/sanitize-stem-cases.json", import.meta.url),
  );
  const cases: Array<{ input: string; expected: string }> = JSON.parse(
    readFileSync(fixturePath, "utf-8"),
  );

  it("has cases", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const { input, expected } of cases) {
    it(`sanitizeStem(${JSON.stringify(input.slice(0, 40))}) === ${JSON.stringify(expected.slice(0, 40))}`, () => {
      expect(sanitizeStem(input)).toBe(expected);
    });
  }

  it("isSafeSanitizedId is exactly sanitizeStem(id) === id for every fixture case", () => {
    for (const { input, expected } of cases) {
      expect(isSafeSanitizedId(input)).toBe(input === expected);
    }
  });
});
