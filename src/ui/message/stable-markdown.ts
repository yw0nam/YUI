/**
 * The longest prefix of streaming markdown that renders the same however the line goes on: a link,
 * an emphasis or code run, or an angle bracket still open, and a word that is or may become a bare
 * URL, wait for the text that closes them.
 */

const SPACE = /\s/;
const WORD = /[\p{L}\p{N}]/u;

/** Where an unclosed `[` starts: no `]`, a `]` at the end, or a `](` with no `)`. */
function openLink(raw: string): number {
  let from = 0;
  for (;;) {
    const open = raw.indexOf("[", from);
    if (open < 0) return raw.length;
    const close = raw.indexOf("]", open);
    if (close < 0 || close === raw.length - 1) return open;
    if (raw[close + 1] === "(" && raw.indexOf(")", close) < 0) return open;
    from = close + 1;
  }
}

/** Where the last of an odd count of `marker` runs starts. */
function openRun(raw: string, marker: string): number {
  const count = raw.split(marker).length - 1;
  return count % 2 === 1 ? raw.lastIndexOf(marker) : raw.length;
}

/** Where a single `*` or `_` emphasis that has not closed yet opens. */
function openEmphasis(raw: string, mark: "*" | "_"): number {
  let open = -1;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== mark || raw[i - 1] === mark || raw[i + 1] === mark) continue;
    const before = raw[i - 1] ?? " ";
    const after = raw[i + 1] ?? " ";
    // An underscore inside a word is text; an emphasis opens before a non-space and closes after one.
    const intraword = mark === "_" && (WORD.test(before) || WORD.test(after));
    if (
      open < 0 &&
      !SPACE.test(after) &&
      !intraword &&
      (SPACE.test(before) || !WORD.test(before))
    ) {
      open = i;
    } else if (open >= 0 && !SPACE.test(before) && !intraword) {
      open = -1;
    }
  }
  return open < 0 ? raw.length : open;
}

/** Where a `<` that may still start a tag or an autolink opens. */
function openAngle(raw: string): number {
  const open = raw.lastIndexOf("<");
  if (open < 0 || raw.indexOf(">", open) >= 0) return raw.length;
  const after = raw[open + 1];
  return after === undefined || !SPACE.test(after) ? open : raw.length;
}

/** Where the word still arriving starts, when it is or may become a bare URL. */
function openUrl(raw: string): number {
  const start = raw.search(/\S*$/);
  const word = raw.slice(start);
  if (word === "" || word.includes("](")) return raw.length;
  const url = /(https?:\/\/|www\.)/i.test(word);
  const maybe = /(?:^|[^\p{L}\p{N}])(?:h|ht|htt|https?|https?:\/{0,2}|w|ww|www)$/iu.test(word);
  return url || maybe ? start : raw.length;
}

export function stableMarkdown(raw: string): string {
  const end = Math.min(
    openLink(raw),
    openRun(raw, "**"),
    openRun(raw, "__"),
    openRun(raw, "~~"),
    openRun(raw, "`"),
    openEmphasis(raw, "*"),
    openEmphasis(raw, "_"),
    openAngle(raw),
    openUrl(raw),
  );
  return raw.slice(0, end);
}
