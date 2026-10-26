/**
 * The longest prefix of streaming markdown whose rendered text only ever grows: a link, an emphasis
 * or code run, a tag, an entity or a block marker still open waits for the text that settles it.
 */

const SPACE = /\s/;
const WORD = /[\p{L}\p{N}]/u;
const ESCAPABLE = /[!-/:-@[-`{-~]/;

/** The line with escapes and closed code spans blanked so their characters count as text, and where an unclosed code run opens. */
function mask(raw: string): { masked: string; openCode: number } {
  const out = raw.split("");
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "\\" && ESCAPABLE.test(raw[i + 1] ?? "")) {
      out[i] = out[i + 1] = "a";
      i++;
    } else if (raw[i] === "`") {
      let run = 1;
      while (raw[i + run] === "`") run++;
      const fence = "`".repeat(run);
      let close = raw.indexOf(fence, i + run);
      while (close >= 0 && (raw[close - 1] === "`" || raw[close + run] === "`")) {
        close = raw.indexOf(fence, close + 1);
      }
      if (close < 0) return { masked: out.join(""), openCode: i };
      for (let j = i; j < close + run; j++) out[j] = "a";
      i = close + run - 1;
    }
  }
  return { masked: out.join(""), openCode: raw.length };
}

/** Where a link or image still open starts: no `]`, a `]` at the end or before `[` or `:`, or a `](` not closed yet. */
function openLink(text: string): number {
  let from = 0;
  for (;;) {
    const open = text.indexOf("[", from);
    if (open < 0) return text.length;
    const start = text[open - 1] === "!" ? open - 1 : open;
    const close = text.indexOf("]", open);
    if (close < 0) return start;
    const next = text[close + 1];
    if (next === undefined || next === "[" || next === ":") return start;
    from = close + 1;
    if (next !== "(") continue;
    let depth = 0;
    let end = -1;
    for (let j = close + 1; j < text.length && end < 0; j++) {
      if (text[j] === "(") depth++;
      else if (text[j] === ")" && --depth === 0) end = j;
    }
    if (end < 0) return start;
    from = end + 1;
  }
}

/** Where the last of an odd count of `marker` runs starts. */
function openRun(text: string, marker: string): number {
  const count = text.split(marker).length - 1;
  return count % 2 === 1 ? text.lastIndexOf(marker) : text.length;
}

/** Where a single `*`, `_` or `~` emphasis that has not closed yet opens. */
function openEmphasis(text: string, mark: string): number {
  let open = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== mark || text[i - 1] === mark || text[i + 1] === mark) continue;
    const before = text[i - 1] ?? " ";
    const after = text[i + 1] ?? " ";
    let canOpen = !SPACE.test(after);
    let canClose = !SPACE.test(before);
    // An underscore between two word characters is text.
    if (mark === "_") {
      canOpen &&= !WORD.test(before);
      canClose &&= !WORD.test(after);
    }
    if (open < 0) {
      if (canOpen) open = i;
    } else if (canClose) open = -1;
  }
  return open < 0 ? text.length : open;
}

/** Where a `<` that may still open a tag or an autolink starts. */
function openAngle(text: string): number {
  const open = text.lastIndexOf("<");
  if (open < 0 || text.indexOf(">", open) >= 0) return text.length;
  const after = text[open + 1];
  return after === undefined || /[A-Za-z/!?]/.test(after) ? open : text.length;
}

/** Where the trailing run of lines that may still become a table starts. */
function openTable(text: string): number {
  const lines = text.split("\n");
  let start = text.length;
  let offset = text.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    offset -= lines[i].length + (i < lines.length - 1 ? 1 : 0);
    const isLast = i === lines.length - 1;
    if (lines[i].trimStart().startsWith("|")) start = offset;
    else if (!(isLast && lines[i] === "")) break;
  }
  return start;
}

/** Where a last line that so far holds only block markers starts. */
function openBlock(text: string): number {
  const lineStart = text.lastIndexOf("\n") + 1;
  const line = text.slice(lineStart);
  const markersOnly = /^ {0,3}(?:[-*+]|\d{1,9}[.)]?|#{1,6}|>|-{2,}|={1,})\s*$/;
  return line !== "" && markersOnly.test(line) ? lineStart : text.length;
}

function trailing(text: string, pattern: RegExp): number {
  const at = text.search(pattern);
  return at < 0 ? text.length : at;
}

export function stableMarkdown(raw: string): string {
  // A cut can leave an earlier construct open ("*hi*" cut to "*hi"), so cut until nothing changes.
  let stable = raw;
  for (let next = cut(stable); next !== stable; next = cut(stable)) stable = next;
  return stable;
}

function cut(raw: string): string {
  const { masked, openCode } = mask(raw);
  const end = Math.min(
    openCode,
    // A marker run, a backslash or a `!` at the very end is settled by the character after it.
    trailing(masked, /[*_~`]+$/),
    trailing(masked, /[\\!]$/),
    trailing(masked, /&#?[A-Za-z0-9]*$/),
    openLink(masked),
    openRun(masked, "**"),
    openRun(masked, "__"),
    openRun(masked, "~~"),
    openEmphasis(masked, "*"),
    openEmphasis(masked, "_"),
    openEmphasis(masked, "~"),
    openAngle(masked),
    openBlock(masked),
    openTable(masked),
  );
  return raw.slice(0, end);
}
