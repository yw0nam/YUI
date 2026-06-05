/**
 * sentence-segmenter.ts — PURE sentence boundary detector. STUB.
 */

export interface SentenceSegmenter {
  push(text: string): string[];
  flush(): string | null;
}

export function createSentenceSegmenter(): SentenceSegmenter {
  return {
    push: () => [],
    flush: () => null,
  };
}
