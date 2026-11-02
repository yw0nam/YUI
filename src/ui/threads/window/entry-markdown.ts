/** An entry's text as sanitised Markdown nodes, with only absolute https images left. */

import { renderMarkdownInline } from "../../message/markdown";

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
  return [...out.childNodes];
}
