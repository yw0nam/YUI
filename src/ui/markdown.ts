/**
 * Markdown renderer for the speech bubble — marked → DOMPurify → <span>.
 *
 * The bubble re-renders the FULL accumulated text on each streaming delta, so
 * marked is used in synchronous mode and tolerates incomplete markdown
 * (unterminated `**`, half-written `[`) by leaving it as literal text.
 *
 * Trust boundary: backend speech text is rendered as HTML, so DOMPurify
 * sanitises it. Scripts and event handlers are stripped; javascript: and data:
 * URLs are rejected on href/src; links open externally (target/rel injected).
 *
 * ponytail: name kept (was inline-only) so callers need no import change.
 */

import DOMPurify, { type Config } from "dompurify";
import { marked } from "marked";

let hooksInstalled = false;

function installHooks(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;

  // Forbid data: on url-bearing attrs — DOMPurify allows data: on img src by
  // default; drop it to match the old all-data:-rejected behaviour.
  DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
    if (
      (data.attrName === "src" || data.attrName === "href") &&
      /^\s*data:/i.test(data.attrValue)
    ) {
      data.keepAttr = false;
    }
  });

  // Links open in a new tab and drop referrer/opener (display surface, not a tab nav).
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
    if (node.tagName === "IMG") {
      node.setAttribute("loading", "lazy");
    }
  });
}

const PURIFY_CONFIG: Config = {
  // javascript: is rejected by DOMPurify's default URI policy; data: is dropped
  // by the uponSanitizeAttribute hook above.
  ADD_ATTR: ["target"],
  ALLOW_DATA_ATTR: false,
};

/**
 * Parses `text` as markdown, sanitises the HTML, and returns a <span> whose
 * innerHTML is the sanitised result. Ready to append to the DOM.
 */
export function renderMarkdownInline(text: string): HTMLSpanElement {
  installHooks();
  const container = document.createElement("span");
  const rawHtml = (marked.parse(text, { async: false }) as string).trim();
  container.innerHTML = DOMPurify.sanitize(rawHtml, PURIFY_CONFIG);
  for (const img of container.querySelectorAll("img")) {
    img.addEventListener("error", () => img.classList.add("is-broken"));
  }
  return container;
}
