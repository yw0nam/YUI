import { describe, expect, it } from "vitest";
import { applyReadings, parseReadings } from "./readings";

const apply = (dict: string, text: string) => applyReadings(text, parseReadings(dict).pairs);

describe("applyReadings", () => {
  it("replaces a listed word", () => {
    expect(apply("秧秧=ヤンヤン", "秧秧、おはよう")).toBe("ヤンヤン、おはよう");
  });

  it("leaves text with no match unchanged", () => {
    expect(apply("秧秧=ヤンヤン", "おはよう")).toBe("おはよう");
  });

  it("replaces the longest surface first", () => {
    expect(apply("秧=ヤン\n秧秧=ヤンヤン", "秧秧秧")).toBe("ヤンヤンヤン");
  });

  it("never replaces a replacement again", () => {
    expect(apply("A=B\nB=C", "A")).toBe("B");
  });

  it("is case-sensitive", () => {
    expect(apply("abc=エービーシー", "ABC abc")).toBe("ABC エービーシー");
  });

  it("treats regex characters in a surface literally", () => {
    expect(apply("C++=シープラ", "C++ and C")).toBe("シープラ and C");
  });
});

describe("parseReadings", () => {
  it("splits each line at the first =", () => {
    expect(parseReadings("a=b=c").pairs).toEqual([["a", "b=c"]]);
  });

  it("reports the 1-based numbers of skipped lines and not blank lines", () => {
    expect(parseReadings("a=b\nnoequals\n\n=x\nc=d")).toEqual({
      pairs: [
        ["a", "b"],
        ["c", "d"],
      ],
      skipped: [2, 4],
    });
  });

  it("skips a line with an empty reading", () => {
    expect(parseReadings("秧秧=")).toEqual({ pairs: [], skipped: [1] });
  });

  it("lets a later duplicate win", () => {
    expect(parseReadings("a=1\na=2").pairs).toEqual([["a", "2"]]);
  });
});
