/** An entry's text as Markdown nodes, with only absolute https images and no list or table formatting whitespace. */

import { renderMarkdownInline } from "../../message/markdown";

const GROUPS = new Set(["UL", "OL", "LI", "TABLE", "THEAD", "TBODY", "TR"]);

function isHttps(src: string | null): boolean {
  try {
    return new URL(src ?? "").protocol === "https:";
  } catch {
    return false;
  }
}

export function entryMarkdown(text: string): ChildNode[] {
  const out = renderMarkdownInline(text);
  for (const img of out.querySelectorAll("img")) {
    if (!isHttps(img.getAttribute("src"))) img.remove();
  }
  // marked's newlines between a list's or table's blocks would show as blank lines under pre-wrap.
  const blanks: Text[] = [];
  const walker = document.createTreeWalker(out, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent?.trim() && GROUPS.has(n.parentElement?.tagName ?? ""))
      blanks.push(n as Text);
  }
  for (const blank of blanks) blank.remove();
  return [...out.childNodes];
}
