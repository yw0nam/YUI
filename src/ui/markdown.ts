/**
 * Inline markdown renderer — MVP scope: links and images only.
 *
 * [text](url) → <a href="url" target="_blank" rel="noopener noreferrer">
 * ![alt](url) → <img src="url" alt="alt" loading="lazy">
 *
 * Everything else stays as escaped plain text. No bold, italic, code, headings,
 * or block-level constructs. Sanitizes URLs: javascript: and data: schemes are
 * rejected.
 *
 * Returns a <span> DocumentFragment wrapper so callers can append it directly.
 */

/** Allowed URL schemes for href/src attributes. */
const SAFE_SCHEMES = /^(https?:|\/|\.\/|#)/i;

function isSafeUrl(url: string): boolean {
  const trimmed = url.trim();
  return SAFE_SCHEMES.test(trimmed);
}

/** Escape HTML special characters to prevent injection in text nodes. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Renders MVP inline markdown (links + images) into a <span> container.
 * The returned element is ready to be appended to the DOM.
 */
export function renderMarkdownInline(text: string): HTMLSpanElement {
  const container = document.createElement("span");

  // Single-pass tokeniser: image before link so ![...] is matched first.
  // Token regex groups: (1) image-alt, (2) image-url, (3) link-text, (4) link-url, (5) plain char.
  const TOKEN = /!\[([^\]]*)\]\(([^)]*)\)|\[([^\]]*)\]\(([^)]*)\)|([\s\S])/g;
  let match: RegExpExecArray | null;
  let plainBuffer = "";

  function flushText(): void {
    if (plainBuffer === "") return;
    container.appendChild(document.createTextNode(plainBuffer));
    plainBuffer = "";
  }

  while ((match = TOKEN.exec(text)) !== null) {
    if (match[1] !== undefined) {
      // Image: ![alt](url)
      flushText();
      const alt = match[1];
      const src = match[2];
      if (isSafeUrl(src)) {
        const img = document.createElement("img");
        img.setAttribute("src", src.trim());
        img.setAttribute("alt", alt);
        img.setAttribute("loading", "lazy");
        container.appendChild(img);
      } else {
        // Unsafe URL — render as escaped plain text
        plainBuffer += `![${escapeHtml(alt)}](${escapeHtml(src)})`;
        flushText();
      }
    } else if (match[3] !== undefined) {
      // Link: [text](url)
      flushText();
      const linkText = match[3];
      const href = match[4];
      if (isSafeUrl(href)) {
        const a = document.createElement("a");
        a.setAttribute("href", href.trim());
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener noreferrer");
        // Link text is plain text (not re-parsed for markdown)
        a.textContent = linkText;
        container.appendChild(a);
      } else {
        // Unsafe URL — render as escaped plain text
        plainBuffer += `[${escapeHtml(linkText)}](${escapeHtml(href)})`;
        flushText();
      }
    } else {
      // Plain character — accumulate; will be added as a text node
      plainBuffer += match[5];
    }
  }

  flushText();
  return container;
}
