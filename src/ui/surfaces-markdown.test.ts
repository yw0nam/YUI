// @vitest-environment jsdom
/**
 * Tests for surfaces.ts changes:
 * 1. showTool(tool_id) resolves label from tool-labels map.
 * 2. pushSpeech / endSpeech renders full markdown (marked + DOMPurify).
 *
 * We import createSurfaces and verify DOM output.
 * CSS imports are ignored (no CSS processing in jsdom).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// CSS imports are not handled in jsdom — mock them
vi.mock("./surfaces.css", () => ({}));
vi.mock("./tokens.css", () => ({}));

import { createSurfaces } from "./surfaces";

function makeSurfaces() {
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  const s = createSurfaces({ mount });
  return { s, mount };
}

describe("showTool — tool_id label resolution", () => {
  let mount: HTMLElement;
  let s: ReturnType<typeof createSurfaces>;

  beforeEach(() => {
    ({ s, mount } = makeSurfaces());
  });

  afterEach(() => {
    s.dispose();
    mount.remove();
  });

  it("shows 'Searching…' for tool_id='web_search'", () => {
    s.showTool("web_search");
    const label = mount.querySelector(".yui-tool__label");
    expect(label?.textContent).toBe("Searching…");
  });

  it("shows 'Browsing…' for tool_id='browser'", () => {
    s.showTool("browser");
    const label = mount.querySelector(".yui-tool__label");
    expect(label?.textContent).toBe("Browsing…");
  });

  it("shows 'Running…' for tool_id='terminal'", () => {
    s.showTool("terminal");
    const label = mount.querySelector(".yui-tool__label");
    expect(label?.textContent).toBe("Running…");
  });

  it("shows generic fallback for unknown tool_id", () => {
    s.showTool("some_unknown_tool");
    const label = mount.querySelector(".yui-tool__label");
    expect(label?.textContent).toBe("Working…");
  });

  it("makes tool chip visible", () => {
    s.showTool("web_search");
    const toolEl = mount.querySelector(".yui-tool");
    expect(toolEl?.getAttribute("hidden")).toBeNull();
  });
});

describe("endSpeech — deferred dwell for TTS playback", () => {
  const DWELL = 5000;
  let mount: HTMLElement;
  let s: ReturnType<typeof createSurfaces>;

  beforeEach(() => {
    vi.useFakeTimers();
    mount = document.createElement("div");
    document.body.appendChild(mount);
    s = createSurfaces({ mount, dwellMs: DWELL });
  });

  afterEach(() => {
    s.dispose();
    mount.remove();
    vi.useRealTimers();
  });

  function bubble(): HTMLElement {
    return mount.querySelector(".yui-bubble") as HTMLElement;
  }

  it("does not auto-hide while deferred, even past the dwell window", () => {
    s.beginSpeech();
    s.pushSpeech("Long answer that is still being spoken aloud.");
    s.endSpeech({ defer: true });
    // way past the fixed dwell — bubble must remain visible while TTS plays.
    vi.advanceTimersByTime(DWELL * 3);
    expect(bubble().classList.contains("is-visible")).toBe(true);
    expect(bubble().hidden).toBe(false);
  });

  it("applies the dwell→fade only after finishSpeech() releases the hold", () => {
    s.beginSpeech();
    s.pushSpeech("Spoken line.");
    s.endSpeech({ defer: true });
    vi.advanceTimersByTime(DWELL * 2);
    expect(bubble().classList.contains("is-visible")).toBe(true);

    s.finishSpeech(); // playback ended → now dwell, then fade
    expect(bubble().classList.contains("is-visible")).toBe(true); // dwell not elapsed
    vi.advanceTimersByTime(DWELL);
    expect(bubble().classList.contains("is-visible")).toBe(false); // faded
  });

  it("non-deferred endSpeech() still fixed-dwell fades (fallback path unchanged)", () => {
    s.beginSpeech();
    s.pushSpeech("No TTS this turn.");
    s.endSpeech();
    expect(bubble().classList.contains("is-visible")).toBe(true);
    vi.advanceTimersByTime(DWELL);
    expect(bubble().classList.contains("is-visible")).toBe(false);
  });

  it("finishSpeech() is a no-op when the bubble is already hidden", () => {
    expect(() => s.finishSpeech()).not.toThrow();
    expect(bubble().hidden).toBe(true);
  });
});

describe("pushSpeech — full markdown rendering", () => {
  let mount: HTMLElement;
  let s: ReturnType<typeof createSurfaces>;

  beforeEach(() => {
    ({ s, mount } = makeSurfaces());
  });

  afterEach(() => {
    s.dispose();
    mount.remove();
  });

  it("renders plain text delta as text content", () => {
    s.beginSpeech();
    s.pushSpeech("Hello world");
    const text = mount.querySelector(".yui-bubble__text");
    expect(text?.textContent).toBe("Hello world");
  });

  it("renders **bold** markdown inside the speech bubble", () => {
    s.beginSpeech();
    s.pushSpeech("Say **hi** now");
    const strong = mount.querySelector(".yui-bubble__text strong");
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe("hi");
  });

  it("renders a markdown list inside the speech bubble", () => {
    s.beginSpeech();
    s.pushSpeech("- one\n- two");
    const items = mount.querySelectorAll(".yui-bubble__text li");
    expect(items).toHaveLength(2);
  });

  it("renders a markdown link inside the speech bubble", () => {
    s.beginSpeech();
    s.pushSpeech("See [docs](https://example.com)");
    const a = mount.querySelector(".yui-bubble__text a");
    expect(a).not.toBeNull();
    expect(a?.getAttribute("href")).toBe("https://example.com");
    expect(a?.textContent).toBe("docs");
  });

  it("renders a markdown image inside the speech bubble", () => {
    s.beginSpeech();
    s.pushSpeech("![Cat](https://example.com/cat.png)");
    const img = mount.querySelector(".yui-bubble__text img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://example.com/cat.png");
    expect(img?.getAttribute("alt")).toBe("Cat");
  });

  it("does not render <script> injected via speech delta", () => {
    s.beginSpeech();
    s.pushSpeech("<script>alert(1)</script>");
    const script = mount.querySelector(".yui-bubble__text script");
    expect(script).toBeNull();
  });

  it("accumulates multiple pushSpeech deltas", () => {
    s.beginSpeech();
    s.pushSpeech("Hello ");
    s.pushSpeech("world");
    const text = mount.querySelector(".yui-bubble__text");
    expect(text?.textContent).toContain("Hello");
    expect(text?.textContent).toContain("world");
  });
});
