/**
 * sentence-segmenter.ts — PURE 문장 경계 감지 (PRD F4 / contract.md §3 step 3).
 *
 * 브라우저/네트워크 의존 없음 — 순수 로직(emotion-resolver.ts와 동일한 pure/impure 분리).
 * push()는 토큰을 누적하고 그동안 발견된 "완성된 문장"만 반환하며, 미완성 꼬리는 버퍼에
 * 남긴다. flush()는 남은 버퍼(trim, 비어있지 않을 때)를 반환하고 비우며, 없으면 null.
 *
 * 경계 규칙(contract.md §3: "분절 방식은 구현 시 결정 — 새 리서치 X"):
 *  - 종결부호 run [.!?…。！？] (1개 이상 연속) + optional 닫는 인용/괄호("'」』）)]} 등)
 *    → 그 뒤가 공백이거나 텍스트 끝이면 경계.
 *  - 개행(\n)도 경계로 본다.
 *  - 약어 NLP 없음. 각 문장은 trim, 빈 문장은 drop.
 *
 * CJK 종결부호(。！？)와 경계를 가로지르는 부분 청크(예: "wor"+"ld.")를 처리한다.
 */

export interface SentenceSegmenter {
  /** 토큰 누적 후 그 시점까지 완성된 문장들을 반환(꼬리는 버퍼 유지). */
  push(text: string): string[];
  /** 버퍼에 남은 텍스트(trim) 반환 후 비움. 비어있으면 null. */
  flush(): string | null;
}

// 닫는 인용/괄호 — 종결부호 직후 이것까지는 한 문장에 포함.
const CLOSERS = "\"'”’」』）)\\]}";
// ASCII 종결부호: run(1+) + 닫는부호(0+) 뒤에 공백/끝일 때만 경계(소수점 "3.14" 오분절 회피).
const ASCII_TERM = ".!?…";
// CJK 종결부호: 공백 없이 이어지는 문장(예: "안녕。반가워！")이 흔하므로 trailing 공백 불요.
const CJK_TERM = "。！？";
// 매칭(최소): 본문 + (ASCII run+closers(?=공백/끝)  |  CJK run+closers  |  개행).
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
        // 빈 매칭 방어(정규식 0폭 매칭 시 무한루프 방지).
        if (m.index === BOUNDARY.lastIndex) {
          BOUNDARY.lastIndex++;
          continue;
        }
        const sentence = m[0].trim();
        if (sentence) out.push(sentence);
        lastEnd = BOUNDARY.lastIndex;
      }

      // 미완성 꼬리만 버퍼에 남긴다.
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
