/**
 * strip-links.test.ts — stateful markdown-link stripper for spoken output_text.
 *
 * Scope: rewrites `[label](url)` to `label` so the voice reads the label only.
 * Bare URLs and plain brackets pass through unchanged.
 * Boundary handling: hold back a trailing run that may still become a link.
 */

import { describe, expect, it } from "vitest";
import { createLinkStripper } from "./strip-links";

describe("createLinkStripper — whole-delta links", () => {
  it("keeps the label and drops the URL of a single link", () => {
    const s = createLinkStripper();
    expect(s.push("Docs: [Example](https://example.com) 확인해봐")).toBe("Docs: Example 확인해봐");
  });

  it("strips two links in one delta", () => {
    const s = createLinkStripper();
    expect(s.push("[첫째](https://a.test/1) 그리고 [둘째](https://b.test/2) 야")).toBe(
      "첫째 그리고 둘째 야",
    );
  });

  it("leaves a bare URL untouched", () => {
    const s = createLinkStripper();
    expect(s.push("https://example.com 봐")).toBe("https://example.com 봐");
    expect(s.flush()).toBe("");
  });

  it("leaves text with no brackets unchanged", () => {
    const s = createLinkStripper();
    expect(s.push("plain text 123")).toBe("plain text 123");
  });

  it("returns an empty string unchanged", () => {
    const s = createLinkStripper();
    expect(s.push("")).toBe("");
  });
});

describe("createLinkStripper — boundary hold-back across deltas", () => {
  it("strips a link split across three deltas as a whole", () => {
    const s = createLinkStripper();
    expect(s.push("봐 [Exa")).toBe("봐 ");
    expect(s.push("mple](https://exa")).toBe("");
    expect(s.push("mple.com/a) 끝")).toBe("Example 끝");
    expect(s.flush()).toBe("");
  });

  it("releases a bracket run as written once the next delta rules out a link", () => {
    const s = createLinkStripper();
    expect(s.push("[b]")).toBe("");
    expect(s.push(" x")).toBe("[b] x");
  });

  it("holds a trailing open bracket that follows a completed link", () => {
    const s = createLinkStripper();
    expect(s.push("[a](b) [c")).toBe("a ");
    expect(s.flush()).toBe("[c");
  });

  it("releases an unbalanced bracket at the end of its line instead of holding the next line", () => {
    const s = createLinkStripper();
    expect(s.push("[abc\n다음 줄")).toBe("[abc\n다음 줄");
    expect(s.flush()).toBe("");
  });
});

describe("createLinkStripper — flush()", () => {
  it("flush with no carry returns an empty string", () => {
    const s = createLinkStripper();
    s.push("hello");
    expect(s.flush()).toBe("");
  });

  it("flush releases an unfinished bracket run as written and clears the carry", () => {
    const s = createLinkStripper();
    expect(s.push("[abc")).toBe("");
    expect(s.flush()).toBe("[abc");
    expect(s.push("z")).toBe("z");
  });
});

describe("createLinkStripper — reset()", () => {
  it("reset drops the carry so the next push starts fresh", () => {
    const s = createLinkStripper();
    s.push("[abc");
    s.reset();
    expect(s.push("z")).toBe("z");
  });

  it("reset on an empty carry is a no-op", () => {
    const s = createLinkStripper();
    s.reset();
    expect(s.push("hello")).toBe("hello");
  });
});
