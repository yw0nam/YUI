import { describe, expect, it } from "vitest";
import { createReadings, parseReadings } from "./readings";

describe("createReadings", () => {
  it.each([
    ["a listed word", "秧秧=ヤンヤン", "秧秧、おはよう", "ヤンヤン、おはよう"],
    ["no match", "秧秧=ヤンヤン", "おはよう", "おはよう"],
    ["longest surface first", "秧=ヤン\n秧秧=ヤンヤン", "秧秧秧", "ヤンヤンヤン"],
    ["one pass", "A=B\nB=C", "A", "B"],
    ["case-sensitive", "abc=エービーシー", "ABC abc", "ABC エービーシー"],
    ["regex characters literal", "C++=シープラ", "C++ and C", "シープラ and C"],
    ["empty dictionary", "", "秧秧", "秧秧"],
  ])("%s", (_name, dict, text, expected) => {
    expect(createReadings(() => dict).apply(text)).toBe(expected);
  });

  it("follows the text as it changes", () => {
    let dict = "a=1";
    const readings = createReadings(() => dict);
    expect(readings.apply("a b")).toBe("1 b");
    dict = "b=2";
    expect(readings.apply("a b")).toBe("a 2");
    expect(readings.text()).toBe("b=2");
  });
});

describe("parseReadings", () => {
  it("splits at the first =, numbers skipped lines (not blank ones), and lets a later duplicate win", () => {
    expect(parseReadings("a=b=c\nnoequals\n\n=x\nd=\ne=1\ne=2")).toEqual({
      pairs: [
        ["a", "b=c"],
        ["e", "2"],
      ],
      skipped: [2, 4, 5],
    });
  });
});
