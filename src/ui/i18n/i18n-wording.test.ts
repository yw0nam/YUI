import { describe, expect, it } from "vitest";
import en from "./en";
import ja from "./ja";
import ko from "./ko";

// Panel strings read as single calm lines: no em-dash chains, at most one middle-dot separator.
const BUNDLES: readonly (readonly [string, Record<string, string>])[] = [
  ["en", en],
  ["ko", ko],
  ["ja", ja],
];

describe("i18n wording", () => {
  for (const [name, bundle] of BUNDLES) {
    it(`${name}: no string value contains an em-dash`, () => {
      const offenders = Object.entries(bundle).filter(([, value]) => value.includes("\u2014"));
      expect(offenders).toEqual([]);
    });

    it(`${name}: every string holds at most one middle dot`, () => {
      const offenders = Object.entries(bundle).filter(
        ([, value]) => (value.match(/·/g) ?? []).length > 1,
      );
      expect(offenders).toEqual([]);
    });
  }
});
