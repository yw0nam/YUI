/** Segments text-stream tokens into sentences. Pure logic (no DOM/network). */

export interface SentenceSegmenter {
  push(text: string): string[];
  flush(): string | null;
}

const CLOSERS = "\"'”’」』）)\\]}";
// ASCII terminators need trailing whitespace/end to count as a boundary — avoids mis-splitting "3.14".
const ASCII_TERM = ".!?…";
// CJK terminators run on without spaces, so no trailing whitespace is required.
const CJK_TERM = "。！？";
const BOUNDARY = new RegExp(
  `([\\s\\S]*?(?:[${ASCII_TERM}]+[${CLOSERS}]*(?=\\s|$)|[${CJK_TERM}]+[${CLOSERS}]*|\\n))`,
  "g",
);

export function createSentenceSegmenter(): SentenceSegmenter {
  let buffer = "";

  return {
    push(text) {
      buffer += text;
      const out: string[] = [];

      BOUNDARY.lastIndex = 0;
      let lastEnd = 0;
      let m: RegExpExecArray | null;
      while ((m = BOUNDARY.exec(buffer)) !== null) {
        if (m.index === BOUNDARY.lastIndex) {
          BOUNDARY.lastIndex++;
          continue;
        }
        const sentence = m[0].trim();
        if (sentence) out.push(sentence);
        lastEnd = BOUNDARY.lastIndex;
      }

      buffer = buffer.slice(lastEnd);
      return out;
    },

    flush() {
      const rest = buffer.trim();
      buffer = "";
      return rest.length > 0 ? rest : null;
    },
  };
}
