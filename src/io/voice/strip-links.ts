/**
 * Stateful markdown-link stripper for spoken output_text deltas: `[label](url)` → `label`.
 *
 * The bubble renders the link itself; the voice reads only the label. Bare URLs pass through.
 *
 * Hold-back: the trailing run from the last `[` that may still become a link (no `]` yet, a `]`
 * whose next char is unknown, or an unclosed `(`) is buffered in carry until the link closes or
 * is ruled out, so a link split across delta boundaries is stripped as a whole.
 */

interface LinkStripper {
  push(delta: string): string;
  flush(): string;
  reset(): void;
}

const LINK = /\[([^\]\n]*)\]\([^)]*\)/g;

// a trailing `[…`, `[…]`, or `[…](…` that the next delta may still complete into a link;
// a label never spans a line, so an unbalanced `[` holds back at most the rest of its line.
const OPEN_TAIL = /\[[^\]\n]*(?:\](?:\([^)]*)?)?$/;

export function createLinkStripper(): LinkStripper {
  let carry = "";

  return {
    push(delta: string): string {
      const input = carry + delta;
      const tailMatch = OPEN_TAIL.exec(input);
      carry = tailMatch ? tailMatch[0] : "";

      return (tailMatch ? input.slice(0, tailMatch.index) : input).replace(LINK, "$1");
    },

    flush(): string {
      // carry never holds a complete link — an unfinished `[` is spoken as written.
      const out = carry;
      carry = "";
      return out;
    },

    reset(): void {
      carry = "";
    },
  };
}
