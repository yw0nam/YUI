/**
 * strip-emoji.test.ts — TDD red: stateful emoji stripper for spoken output_text.
 *
 * Scope: removes Extended_Pictographic + emoji modifier codepoints (ZWJ, VS16,
 * skin-tone, regional indicators, keycap). Preserves all other text.
 * Boundary handling: hold back trailing emoji-class runs across delta boundaries.
 */

import { describe, expect, it } from "vitest";
import { createEmojiStripper } from "./strip-emoji";

describe("createEmojiStripper — basic removal", () => {
  it("removes a single trailing emoji from a Korean phrase", () => {
    const s = createEmojiStripper();
    expect(s.push("잘 왔어 ✨")).toBe("잘 왔어 ");
  });

  it("removes a mid-string emoji", () => {
    const s = createEmojiStripper();
    expect(s.push("hello 😠 world")).toBe("hello  world");
  });

  it("removes a leading emoji", () => {
    const s = createEmojiStripper();
    expect(s.push("💤 내일 봐")).toBe(" 내일 봐");
  });

  it("returns the string unchanged when there are no emoji", () => {
    const s = createEmojiStripper();
    expect(s.push("plain text 123")).toBe("plain text 123");
  });

  it("returns an empty string unchanged (no crash, no whitespace added)", () => {
    const s = createEmojiStripper();
    expect(s.push("")).toBe("");
  });
});

describe("createEmojiStripper — preserved characters", () => {
  it("preserves Korean characters", () => {
    const s = createEmojiStripper();
    expect(s.push("안녕하세요")).toBe("안녕하세요");
  });

  it("preserves Latin text", () => {
    const s = createEmojiStripper();
    expect(s.push("Hello World")).toBe("Hello World");
  });

  it("preserves ordinary punctuation including ellipsis, em dash, smart quotes", () => {
    const s = createEmojiStripper();
    // U+2026 ellipsis, U+2014 em dash, U+2018/U+2019 smart single, U+201C/U+201D smart double
    const text = "…—‘’“”";
    expect(s.push(text)).toBe(text);
  });

  it("preserves math and currency symbols", () => {
    const s = createEmojiStripper();
    expect(s.push("$100 + €50 = ¥15000")).toBe("$100 + €50 = ¥15000");
  });

  it("preserves digits and whitespace", () => {
    const s = createEmojiStripper();
    expect(s.push("  42  ")).toBe("  42  ");
  });
});

describe("createEmojiStripper — complex emoji sequences removed", () => {
  it("removes a ZWJ family sequence (👨‍👩‍👧)", () => {
    const s = createEmojiStripper();
    // ZWJ sequence: man ZWJ woman ZWJ girl — all should be stripped
    expect(s.push("family: 👨‍👩‍👧")).toBe("family: ");
  });

  it("removes VS16 variation selector (text → emoji)", () => {
    const s = createEmojiStripper();
    // U+2764 + U+FE0F = red heart emoji variant
    expect(s.push("love❤️")).toBe("love");
  });

  it("removes skin-tone modified emoji (👋🏽)", () => {
    const s = createEmojiStripper();
    expect(s.push("wave 👋🏽")).toBe("wave ");
  });

  it("removes regional indicator flag sequence (🇰🇷)", () => {
    const s = createEmojiStripper();
    // 🇰🇷 = U+1F1F0 U+1F1F7 (regional indicator K + R)
    expect(s.push("flag 🇰🇷")).toBe("flag ");
  });

  it("removes keycap sequence (#️⃣)", () => {
    const s = createEmojiStripper();
    // # + VS16 + combining enclosing keycap U+20E3
    expect(s.push("key #️⃣ pressed")).toBe("key  pressed");
  });
});

describe("createEmojiStripper — boundary hold-back across deltas", () => {
  it("holds back a trailing emoji and releases it as removed on the next push", () => {
    const s = createEmojiStripper();
    // trailing 👨 may be start of a ZWJ sequence in the next delta
    const first = s.push("hello 👨");
    // emoji is held in carry — not yet emitted
    expect(first).toBe("hello ");
    // next delta is just text, so the held-back emoji is confirmed removable
    const second = s.push(" world");
    expect(second).toBe(" world");
  });

  it("handles ZWJ split across two deltas without leaking the head codepoint", () => {
    const s = createEmojiStripper();
    // split 👨‍👩 across deltas: first delta ends with 👨, second starts with ZWJ+👩
    const first = s.push("hi 👨");
    expect(first).toBe("hi ");
    const second = s.push("‍👩 bye");
    // the ZWJ+👩 continuation merges with the held 👨 → whole sequence stripped
    expect(second).toBe(" bye");
  });

  it("hold-back does not persist across independent push calls with non-emoji between", () => {
    const s = createEmojiStripper();
    s.push("start 🎉");
    const second = s.push("next text");
    expect(second).toBe("next text");
  });
});

describe("createEmojiStripper — flush()", () => {
  it("flush with no carry returns empty string", () => {
    const s = createEmojiStripper();
    s.push("hello");
    expect(s.flush()).toBe("");
  });

  it("flush discards the carry and returns empty string (carry is all emoji)", () => {
    const s = createEmojiStripper();
    s.push("hello ✨");
    // ✨ is trailing emoji-class → in carry; flush discards it
    expect(s.flush()).toBe("");
  });

  it("after flush, the carry is cleared so the next push starts fresh", () => {
    const s = createEmojiStripper();
    s.push("hello ✨");
    s.flush();
    const result = s.push("new text");
    expect(result).toBe("new text");
  });
});

describe("createEmojiStripper — reset()", () => {
  it("reset clears carry so the next push starts fresh (prevents cross-turn leak)", () => {
    const s = createEmojiStripper();
    s.push("partial 👨");
    s.reset();
    const result = s.push("fresh text");
    expect(result).toBe("fresh text");
  });

  it("reset on empty carry is a no-op", () => {
    const s = createEmojiStripper();
    s.reset();
    expect(s.push("hello")).toBe("hello");
  });
});
