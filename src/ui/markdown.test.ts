// @vitest-environment jsdom
/**
 * Tests for src/ui/markdown.ts — full markdown renderer (marked + DOMPurify).
 *
 * The speech bubble re-renders the FULL accumulated text on each streaming
 * delta, so the renderer must (1) handle full markdown — bold/italic/code/
 * lists/headings/links/images, (2) tolerate partial/incomplete markdown
 * (unterminated `**`, half-written `[`), and (3) hold the sanitisation trust
 * boundary: no scripts, no javascript:/data: URLs, links open externally.
 */

import { describe, expect, it } from "vitest";
import { renderMarkdownInline } from "./markdown";

describe("renderMarkdownInline — full markdown", () => {
  // ── inline emphasis / code ─────────────────────────────────

  it("renders **bold** as <strong>", () => {
    const node = renderMarkdownInline("Hello **world**");
    expect(node.querySelector("strong")).not.toBeNull();
    expect(node.querySelector("strong")!.textContent).toBe("world");
  });

  it("renders _italic_ as <em>", () => {
    const node = renderMarkdownInline("Hello _world_");
    expect(node.querySelector("em")).not.toBeNull();
    expect(node.querySelector("em")!.textContent).toBe("world");
  });

  it("renders `code` as inline <code>", () => {
    const node = renderMarkdownInline("Use `npm install`");
    const code = node.querySelector("code");
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe("npm install");
  });

  it("renders a fenced code block as <pre><code>", () => {
    const node = renderMarkdownInline("```\nconst x = 1;\n```");
    const pre = node.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre!.querySelector("code")).not.toBeNull();
    expect(pre!.textContent).toContain("const x = 1;");
  });

  // ── block-level ────────────────────────────────────────────

  it("renders an unordered list as <ul><li>", () => {
    const node = renderMarkdownInline("- one\n- two");
    expect(node.querySelector("ul")).not.toBeNull();
    expect(node.querySelectorAll("li")).toHaveLength(2);
  });

  it("renders an ordered list as <ol><li>", () => {
    const node = renderMarkdownInline("1. first\n2. second");
    expect(node.querySelector("ol")).not.toBeNull();
    expect(node.querySelectorAll("li")).toHaveLength(2);
  });

  it("renders headings as <h1>..<h3>", () => {
    expect(renderMarkdownInline("# Title").querySelector("h1")).not.toBeNull();
    expect(renderMarkdownInline("## Sub").querySelector("h2")).not.toBeNull();
    expect(renderMarkdownInline("### Small").querySelector("h3")).not.toBeNull();
  });

  it("renders a blockquote", () => {
    const node = renderMarkdownInline("> quoted");
    expect(node.querySelector("blockquote")).not.toBeNull();
    expect(node.textContent).toContain("quoted");
  });

  it("renders a horizontal rule as <hr>", () => {
    const node = renderMarkdownInline("---");
    expect(node.querySelector("hr")).not.toBeNull();
  });

  // ── links ──────────────────────────────────────────────────

  it("renders [text](url) as an anchor element", () => {
    const node = renderMarkdownInline("[Open](https://example.com)");
    const a = node.querySelector("a");
    expect(a).not.toBeNull();
    expect(a!.textContent).toBe("Open");
    expect(a!.getAttribute("href")).toBe("https://example.com");
  });

  it("link opens in a new tab with rel=noopener noreferrer", () => {
    const node = renderMarkdownInline("[Link](https://example.com)");
    const a = node.querySelector("a")!;
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
    expect(a.getAttribute("rel")).toContain("noreferrer");
  });

  it("renders multiple links in one string", () => {
    const node = renderMarkdownInline("[A](https://a.com) and [B](https://b.com)");
    const links = node.querySelectorAll("a");
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toBe("https://a.com");
    expect(links[1].getAttribute("href")).toBe("https://b.com");
  });

  // ── images ─────────────────────────────────────────────────

  it("renders ![alt](url) as an img element", () => {
    const node = renderMarkdownInline("![Cat](https://example.com/cat.png)");
    const img = node.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("https://example.com/cat.png");
    expect(img!.getAttribute("alt")).toBe("Cat");
  });

  it("img has loading=lazy", () => {
    const node = renderMarkdownInline("![Alt](https://example.com/x.png)");
    const img = node.querySelector("img")!;
    expect(img.getAttribute("loading")).toBe("lazy");
  });

  // ── streaming safety: partial markdown must not throw ──────

  it("does not throw on an unterminated bold marker", () => {
    expect(() => renderMarkdownInline("Hello **wor")).not.toThrow();
    const node = renderMarkdownInline("Hello **wor");
    expect(node.textContent).toContain("Hello");
  });

  it("does not throw on a half-written link", () => {
    expect(() => renderMarkdownInline("see [docs](https:/")).not.toThrow();
    const node = renderMarkdownInline("see [docs](https:/");
    expect(node.textContent).toContain("see");
  });

  it("handles empty string gracefully", () => {
    const node = renderMarkdownInline("");
    expect(node.textContent).toBe("");
  });

  // ── security / sanitisation trust boundary ─────────────────

  it("strips <script> from input", () => {
    const node = renderMarkdownInline("<script>alert(1)</script>hi");
    expect(node.querySelector("script")).toBeNull();
  });

  it("strips inline event handlers", () => {
    const node = renderMarkdownInline('<img src="x" onerror="alert(1)">');
    const img = node.querySelector("img");
    if (img !== null) expect(img.getAttribute("onerror")).toBeNull();
  });

  it("rejects javascript: URLs in links", () => {
    const node = renderMarkdownInline("[bad](javascript:alert(1))");
    const a = node.querySelector("a");
    if (a !== null) {
      const href = a.getAttribute("href") ?? "";
      expect(href.toLowerCase().startsWith("javascript:")).toBe(false);
    }
  });

  it("rejects data: URLs in links", () => {
    const node = renderMarkdownInline("[x](data:text/html,<h1>hi</h1>)");
    const a = node.querySelector("a");
    if (a !== null) {
      const href = a.getAttribute("href") ?? "";
      expect(href.toLowerCase().startsWith("data:")).toBe(false);
    }
  });

  it("rejects data: URLs in image src", () => {
    const node = renderMarkdownInline("![x](data:text/html,<h1>hi</h1>)");
    const img = node.querySelector("img");
    if (img !== null) {
      const src = img.getAttribute("src") ?? "";
      expect(src.toLowerCase().startsWith("data:")).toBe(false);
    }
  });

  it("returns plain text unchanged when no markdown syntax present", () => {
    const node = renderMarkdownInline("Just plain text, nothing special.");
    expect(node.textContent).toContain("Just plain text, nothing special.");
    expect(node.querySelector("a")).toBeNull();
    expect(node.querySelector("img")).toBeNull();
  });
});
