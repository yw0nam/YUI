/** An entry's text as Markdown nodes: only the elements and attributes Markdown produces, and absolute https images. */

import DOMPurify from "dompurify";
import { renderMarkdownInline } from "../../message/markdown";

const TAGS =
  "p br h1 h2 h3 h4 h5 h6 ul ol li strong em del code pre blockquote hr a img table thead tbody tr th td input".split(
    " ",
  );
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
  return [...out.childNodes];
}
