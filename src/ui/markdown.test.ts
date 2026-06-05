// @vitest-environment jsdom
/**
 * Tests for src/ui/markdown.ts — inline markdown renderer (MVP: links + images only).
 *
 * MVP scope: [text](url) → <a>, ![alt](url) → <img>. Everything else stays plain text.
 * Security: HTML in input is escaped; only safe inline elements are emitted.
 */

import { describe, it, expect } from "vitest";
import { renderMarkdownInline } from "./markdown";

describe("renderMarkdownInline", () => {
  // ── link rendering ─────────────────────────────────────────

  it("renders [text](url) as an anchor element", () => {
    const node = renderMarkdownInline("[Open](https://example.com)");
    const a = node.querySelector("a");
    expect(a).not.toBeNull();
    expect(a!.textContent).toBe("Open");
    expect(a!.getAttribute("href")).toBe("https://example.com");
  });

  it("link opens in a new tab with rel=noopener", () => {
    const node = renderMarkdownInline("[Link](https://example.com)");
    const a = node.querySelector("a")!;
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
  });

  it("renders multiple links in one string", () => {
    const node = renderMarkdownInline("[A](https://a.com) and [B](https://b.com)");
    const links = node.querySelectorAll("a");
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toBe("https://a.com");
    expect(links[1].getAttribute("href")).toBe("https://b.com");
  });

  it("keeps plain text between links", () => {
    const node = renderMarkdownInline("Hello [World](https://w.com) today");
    expect(node.textContent).toContain("Hello");
    expect(node.textContent).toContain("today");
  });

  // ── image rendering ────────────────────────────────────────

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

  it("renders image with empty alt", () => {
    const node = renderMarkdownInline("![](https://example.com/icon.png)");
    const img = node.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("alt")).toBe("");
  });

  it("renders both image and link in one string", () => {
    const node = renderMarkdownInline("See ![icon](https://a.com/i.png) and [here](https://b.com)");
    expect(node.querySelector("img")).not.toBeNull();
    expect(node.querySelector("a")).not.toBeNull();
  });

  it("adds is-broken class when an inline image fails to load", () => {
    const node = renderMarkdownInline("![chart](https://example.com/c.png)");
    const img = node.querySelector("img")!;
    expect(img.classList.contains("is-broken")).toBe(false);
    img.dispatchEvent(new Event("error"));
    expect(img.classList.contains("is-broken")).toBe(true);
  });

  // ── plain text passthrough ─────────────────────────────────

  it("returns plain text unchanged when no markdown syntax present", () => {
    const node = renderMarkdownInline("Just plain text, nothing special.");
    expect(node.textContent).toBe("Just plain text, nothing special.");
    expect(node.querySelector("a")).toBeNull();
    expect(node.querySelector("img")).toBeNull();
  });

  it("does not render **bold** — passes through as plain text", () => {
    const node = renderMarkdownInline("Hello **world**");
    expect(node.textContent).toBe("Hello **world**");
    expect(node.querySelector("strong")).toBeNull();
    expect(node.querySelector("b")).toBeNull();
  });

  it("does not render _italic_ — passes through as plain text", () => {
    const node = renderMarkdownInline("Hello _world_");
    expect(node.textContent).toBe("Hello _world_");
  });

  it("does not render `code` — passes through as plain text", () => {
    const node = renderMarkdownInline("Use `npm install`");
    expect(node.textContent).toBe("Use `npm install`");
    expect(node.querySelector("code")).toBeNull();
  });

  // ── security / escaping ────────────────────────────────────

  it("escapes raw HTML in plain text", () => {
    const node = renderMarkdownInline("<script>alert(1)</script>");
    expect(node.querySelector("script")).toBeNull();
    expect(node.textContent).toContain("<script>");
  });

  it("escapes HTML within link text", () => {
    const node = renderMarkdownInline("[<b>click</b>](https://example.com)");
    const a = node.querySelector("a");
    expect(a).not.toBeNull();
    // link text is escaped — no child <b> element
    expect(a!.querySelector("b")).toBeNull();
    expect(a!.textContent).toContain("click");
  });

  it("rejects javascript: URLs in links — renders as plain text or strips href", () => {
    const node = renderMarkdownInline("[bad](javascript:alert(1))");
    const a = node.querySelector("a");
    // either no anchor or href is stripped/sanitized
    if (a !== null) {
      const href = a.getAttribute("href") ?? "";
      expect(href.toLowerCase().startsWith("javascript:")).toBe(false);
    }
  });

  it("rejects javascript: URLs in images — src is stripped", () => {
    const node = renderMarkdownInline("![x](javascript:alert(1))");
    const img = node.querySelector("img");
    if (img !== null) {
      const src = img.getAttribute("src") ?? "";
      expect(src.toLowerCase().startsWith("javascript:")).toBe(false);
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

  it("handles empty string gracefully", () => {
    const node = renderMarkdownInline("");
    expect(node.textContent).toBe("");
  });

  it("handles string with only whitespace", () => {
    const node = renderMarkdownInline("   ");
    expect(node.textContent).toBe("   ");
  });
});
