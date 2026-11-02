/** An entry's text as Markdown nodes: only the elements and attributes Markdown produces, and absolute https images. */

import DOMPurify from "dompurify";
import { renderMarkdownInline } from "../../message/markdown";

const TAGS =
  "p br h1 h2 h3 h4 h5 h6 ul ol li strong em del code pre blockquote hr a img table thead tbody tr th td input".split(
    " ",
  );
const GROUPS = new Set(["UL", "OL", "LI", "TABLE", "THEAD", "TBODY", "TR"]);
const ATTRS = "href src alt title target rel align start type checked disabled".split(" ");

function isHttps(src: string | null): boolean {
  try {
    return new URL(src ?? "").protocol === "https:";
  } catch {
    return false;
  }
}

export function entryMarkdown(text: string): ChildNode[] {
  const out = document.createElement("div");
  out.innerHTML = DOMPurify.sanitize(renderMarkdownInline(text).innerHTML, {
    ALLOWED_TAGS: TAGS,
    ALLOWED_ATTR: ATTRS,
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
  });
  for (const img of out.querySelectorAll("img")) {
    if (!isHttps(img.getAttribute("src"))) img.remove();
  }
  // The task list's checkbox, shown disabled, is the only form control that survives.
  for (const input of out.querySelectorAll("input")) {
    if (input.type === "checkbox") {
      input.removeAttribute("src");
      input.disabled = true;
    } else input.remove();
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
