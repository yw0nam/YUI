/**
 * sentence-segmenter.test.ts — PURE sentence boundary detection.
 *
 * Target: createSentenceSegmenter() — push(text) accumulates and returns only complete sentences as array,
 * incomplete tail remains in buffer. flush() returns remaining buffer (trimmed, when non-empty), or null.
 *
 * Boundary rules:
 *  - Terminal punctuation run (.!?…。！？) + optional closing quote/bracket → whitespace/end.
 *  - Newline also segments.
 *  - No abbreviation NLP. Each sentence trimmed, empty sentences dropped.
 */

import { describe, expect, it } from "vitest";
import { createSentenceSegmenter } from "./sentence-segmenter";

describe("createSentenceSegmenter — push()", () => {
  it("splits multiple complete sentences in one push", () => {
    const seg = createSentenceSegmenter();
    expect(seg.push("Hello world. How are you? I am fine!")).toEqual([
      "Hello world.",
      "How are you?",
      "I am fine!",
    ]);
  });

  it("buffers an incomplete sentence across two pushes (boundary in 2nd)", () => {
    const seg = createSentenceSegmenter();
    expect(seg.push("Hello wor")).toEqual([]);
    expect(seg.push("ld. Next one.")).toEqual(["Hello world.", "Next one."]);
  });

  it("returns nothing when there is no boundary yet (pure buffering)", () => {
    const seg = createSentenceSegmenter();
    expect(seg.push("no boundary here")).toEqual([]);
    expect(seg.push(" still going")).toEqual([]);
  });

  it("splits on newline even without terminal punctuation", () => {
    const seg = createSentenceSegmenter();
    expect(seg.push("line one\nline two\n")).toEqual(["line one", "line two"]);
  });

  it("handles CJK punctuation (。！？)", () => {
    const seg = createSentenceSegmenter();
    expect(seg.push("안녕하세요。반가워요！정말？")).toEqual([
      "안녕하세요。",
      "반가워요！",
      "정말？",
    ]);
  });

  it("keeps a run of terminal punctuation together (ellipsis, !?)", () => {
    const seg = createSentenceSegmenter();
    expect(seg.push("Really?! Yes... ok.")).toEqual(["Really?!", "Yes...", "ok."]);
  });

  it("includes closing quote/bracket after terminal punctuation in the sentence", () => {
    const seg = createSentenceSegmenter();
    expect(seg.push('She said "hi!" Then left.')).toEqual(['She said "hi!"', "Then left."]);
  });

  it("trims whitespace from emitted sentences and drops empty ones", () => {
    const seg = createSentenceSegmenter();
    expect(seg.push("  spaced out.   \n\n  next.  ")).toEqual(["spaced out.", "next."]);
  });
});

describe("createSentenceSegmenter — flush()", () => {
  it("returns the trimmed buffered remainder", () => {
    const seg = createSentenceSegmenter();
    seg.push("complete. remainder without end");
    expect(seg.flush()).toBe("remainder without end");
  });

  it("returns null when buffer is empty", () => {
    const seg = createSentenceSegmenter();
    seg.push("all done.");
    expect(seg.flush()).toBeNull();
  });

  it("returns null when buffer is only whitespace", () => {
    const seg = createSentenceSegmenter();
    seg.push("done.   \n  ");
    expect(seg.flush()).toBeNull();
  });

  it("clears the buffer after flush (second flush is null)", () => {
    const seg = createSentenceSegmenter();
    seg.push("tail");
    expect(seg.flush()).toBe("tail");
    expect(seg.flush()).toBeNull();
  });
});
