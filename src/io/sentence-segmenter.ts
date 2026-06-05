/** 텍스트 스트림 토큰을 문장 단위로 분절한다. 순수 로직(no DOM/network). */

export interface SentenceSegmenter {
  push(text: string): string[];
  flush(): string | null;
}

const CLOSERS = "\"'”’」』）)\\]}";
// ASCII 종결부호는 뒤에 공백/끝이 와야 경계 — "3.14" 오분절 회피.
const ASCII_TERM = ".!?…";
// CJK 종결부호는 공백 없이 이어지므로 trailing 공백 불요.
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
