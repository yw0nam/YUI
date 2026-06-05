/**
 * sentence-segmenter.test.ts — PURE sentence boundary detection (TDD red, #14).
 *
 * 대상: createSentenceSegmenter() — push(text)는 누적 후 완성된 문장만 배열로 반환하고
 * 미완성 꼬리는 버퍼에 남긴다. flush()는 남은 버퍼(trim, 비어있지 않을 때)를 반환, 없으면 null.
 *
 * 경계 규칙(contract.md §3 step 3, "구현 시 결정 — 새 리서치 X"):
 *  - 종결부호 run(.!?…。！？) + optional 닫는 인용/괄호 → whitespace/끝.
 *  - newline도 분절.
 *  - 약어 NLP 없음. 각 문장 trim, 빈 문장 drop.
 */

import { describe, it, expect } from "vitest";
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
    expect(seg.push('She said "hi!" Then left.')).toEqual([
      'She said "hi!"',
      "Then left.",
    ]);
  });

  it("trims whitespace from emitted sentences and drops empty ones", () => {
    const seg = createSentenceSegmenter();
    expect(seg.push("  spaced out.   \n\n  next.  ")).toEqual([
      "spaced out.",
      "next.",
    ]);
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
