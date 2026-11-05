/**
 * Markdown renderer for the speech bubble and the Threads window's entries — marked → DOMPurify → <span>.
 *
 * The bubble re-lexes the FULL accumulated text on each streaming delta, so
 * marked is used in synchronous mode and tolerates incomplete markdown
 * (unterminated `**`, half-written `[`) by leaving it as literal text.
 *
 * Trust boundary: backend speech text and Thread entries are rendered as HTML,
 * so DOMPurify keeps only the tags and attributes Markdown produces. javascript:
 * and data: URLs are rejected on href/src; links open externally (target/rel
 * injected); the only form control left is a task list's disabled checkbox.
 */

import DOMPurify, { type Config } from "dompurify";
import { Marked } from "marked";

// Only `~~text~~` strikes: a single tilde ("~5 minutes") is text. false hands `~~` to marked's own rule.
const del = (src: string): undefined | false => (/^~(?!~)/.test(src) ? undefined : false);

const fullMarked = new Marked({ tokenizer: { del } });

// A line still arriving links nothing bare: a URL or an address may not have all its characters yet.
const streamingMarked = new Marked({ tokenizer: { del, url: () => undefined } });

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
  ALLOWED_TAGS:
    "p br h1 h2 h3 h4 h5 h6 ul ol li strong em del code pre blockquote hr a img table thead tbody tr th td input".split(
      " ",
    ),
  ALLOWED_ATTR: "href src alt title target rel align start type checked disabled".split(" "),
  ALLOW_ARIA_ATTR: false,
  ALLOW_DATA_ATTR: false,
};

/**
 * Parses `text` as markdown, sanitises the HTML, and returns a <span> whose
 * innerHTML is the sanitised result. Ready to append to the DOM. A streaming
 * line leaves bare URLs and email addresses as text.
 */
export function renderMarkdownInline(
  text: string,
  opts?: { streaming?: boolean },
): HTMLSpanElement {
  const parser = opts?.streaming ? streamingMarked : fullMarked;
  return sanitize((parser.parse(text, { async: false }) as string).trim());
}

/**
 * `text` split into its top-level blocks, each with a key that changes whenever its rendering would, and a
 * render that returns that block's part of `renderMarkdownInline(text)`. The text is lexed whole: a reference
 * definition can change an earlier block. Raw HTML can open a tag in one block and close it in another, so a
 * text holding any is one block rendered whole.
 */
export function markdownBlocks(
  text: string,
  streaming: boolean,
): { key: string; render(): HTMLSpanElement }[] {
  const parser = streaming ? streamingMarked : fullMarked;
  const tokens = parser.lexer(text);
  let html = false;
  parser.walkTokens(tokens, (token) => {
    if (token.type === "html") html = true;
  });
  if (html) {
    return [
      { key: `${streaming}\0${text}`, render: () => renderMarkdownInline(text, { streaming }) },
    ];
  }
  const blocks = tokens.filter((token) => token.type !== "space" && token.type !== "def");
  const links = JSON.stringify(tokens.links);
  return blocks.map((token, index) => {
    // The whole rendering is trimmed: only the last block's trailing newline goes.
    const last = index === blocks.length - 1;
    return {
      key: JSON.stringify([streaming, links, last, token.raw]),
      render() {
        const out = parser.parser([token]);
        return sanitize(last ? out.trimEnd() : out);
      },
    };
  });
}

function sanitize(html: string): HTMLSpanElement {
  installHooks();
  const container = document.createElement("span");
  container.innerHTML = DOMPurify.sanitize(html, PURIFY_CONFIG);
  for (const input of container.querySelectorAll("input")) {
    if (input.type === "checkbox") {
      input.removeAttribute("src");
      input.disabled = true;
    } else input.remove();
  }
  return container;
}
