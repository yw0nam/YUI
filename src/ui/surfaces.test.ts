// @vitest-environment jsdom
/**
 * Tests for surfaces.ts speech-bubble auto-scroll.
 *
 * The bubble is height-capped (internal scroll), so the newest text must stay
 * visible — pushSpeech scrolls the bubble to its end after each update.
 * jsdom reports scrollHeight=0, so we stub it to assert the scroll behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

describe("pushSpeech — auto-scroll to newest line", () => {
  let mount: HTMLElement;
  let s: ReturnType<typeof createSurfaces>;

  beforeEach(() => {
    ({ s, mount } = makeSurfaces());
  });

  afterEach(() => {
    s.dispose();
    mount.remove();
  });

  function bubble(): HTMLElement {
    return mount.querySelector(".yui-bubble") as HTMLElement;
  }

  it("scrolls the bubble to the bottom after pushSpeech", () => {
    s.beginSpeech();
    const bubbleEl = bubble();
    Object.defineProperty(bubbleEl, "scrollHeight", {
      value: 240,
      configurable: true,
    });
    s.pushSpeech("A long line that overflows the capped bubble height.");
    expect(bubbleEl.scrollTop).toBe(240);
  });

  it("re-scrolls to the new end as more text arrives", () => {
    s.beginSpeech();
    const bubbleEl = bubble();
    Object.defineProperty(bubbleEl, "scrollHeight", {
      value: 240,
      configurable: true,
    });
    s.pushSpeech("First chunk.");
    expect(bubbleEl.scrollTop).toBe(240);

    Object.defineProperty(bubbleEl, "scrollHeight", {
      value: 480,
      configurable: true,
    });
    s.pushSpeech(" Second chunk that grows the content further.");
    expect(bubbleEl.scrollTop).toBe(480);
  });
});

describe("pushSpeech — is-scrollable toggle (top-fade only when overflowing)", () => {
  let mount: HTMLElement;
  let s: ReturnType<typeof createSurfaces>;

  beforeEach(() => {
    ({ s, mount } = makeSurfaces());
  });

  afterEach(() => {
    s.dispose();
    mount.remove();
  });

  function bubble(): HTMLElement {
    return mount.querySelector(".yui-bubble") as HTMLElement;
  }

  function stub(el: HTMLElement, scrollHeight: number, clientHeight: number): void {
    Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
  }

  it("does NOT mark a short (non-overflowing) bubble scrollable — first line stays unfaded", () => {
    s.beginSpeech();
    const bubbleEl = bubble();
    stub(bubbleEl, 40, 40); // content fits — no overflow
    s.pushSpeech("Short reply.");
    expect(bubbleEl.classList.contains("is-scrollable")).toBe(false);
  });

  it("marks an overflowing bubble scrollable so the top fade applies", () => {
    s.beginSpeech();
    const bubbleEl = bubble();
    stub(bubbleEl, 480, 240); // content overflows the capped height
    s.pushSpeech("A very long reply that exceeds the capped bubble height.");
    expect(bubbleEl.classList.contains("is-scrollable")).toBe(true);
  });

  it("clears is-scrollable when content shrinks back to fitting", () => {
    s.beginSpeech();
    const bubbleEl = bubble();
    stub(bubbleEl, 480, 240);
    s.pushSpeech("Long overflowing reply.");
    expect(bubbleEl.classList.contains("is-scrollable")).toBe(true);

    s.beginSpeech(); // replace-on-new resets content
    stub(bubbleEl, 40, 40);
    s.pushSpeech("Short.");
    expect(bubbleEl.classList.contains("is-scrollable")).toBe(false);
  });
});

describe("dwell-pause on hover", () => {
  let mount: HTMLElement;
  let s: ReturnType<typeof createSurfaces>;

  beforeEach(() => {
    vi.useFakeTimers();
    mount = document.createElement("div");
    document.body.appendChild(mount);
    s = createSurfaces({ mount, dwellMs: 5000 });
  });

  afterEach(() => {
    s.dispose();
    mount.remove();
    vi.useRealTimers();
  });

  function bubble(): HTMLElement {
    return mount.querySelector(".yui-bubble") as HTMLElement;
  }

  function stub(el: HTMLElement, scrollHeight: number, clientHeight: number): void {
    Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
  }

  it("pauses the dwell while hovering an overflowing bubble", () => {
    s.beginSpeech();
    const bubbleEl = bubble();
    stub(bubbleEl, 480, 240); // overflows the capped height
    s.pushSpeech("A very long reply that exceeds the capped bubble height.");
    s.endSpeech();
    expect(bubbleEl.classList.contains("is-visible")).toBe(true); // precondition
    expect(bubbleEl.classList.contains("is-scrollable")).toBe(true);

    bubbleEl.dispatchEvent(new Event("pointerenter"));
    vi.advanceTimersByTime(6000);
    expect(bubbleEl.classList.contains("is-visible")).toBe(true); // still reading
  });

  it("resumes the dwell when the pointer leaves", () => {
    s.beginSpeech();
    const bubbleEl = bubble();
    stub(bubbleEl, 480, 240);
    s.pushSpeech("A very long reply that exceeds the capped bubble height.");
    s.endSpeech();

    bubbleEl.dispatchEvent(new Event("pointerenter"));
    vi.advanceTimersByTime(6000);
    expect(bubbleEl.classList.contains("is-visible")).toBe(true); // paused

    bubbleEl.dispatchEvent(new Event("pointerleave"));
    vi.advanceTimersByTime(6000);
    expect(bubbleEl.classList.contains("is-visible")).toBe(false); // resumed → hidden
  });

  it("does NOT pause for a short (non-overflowing) bubble", () => {
    s.beginSpeech();
    const bubbleEl = bubble();
    stub(bubbleEl, 40, 40); // fits — not scrollable
    s.pushSpeech("Short reply.");
    s.endSpeech();
    expect(bubbleEl.classList.contains("is-scrollable")).toBe(false);

    bubbleEl.dispatchEvent(new Event("pointerenter"));
    vi.advanceTimersByTime(6000);
    expect(bubbleEl.classList.contains("is-visible")).toBe(false); // hover did not pause
  });
});

describe("setInputAnchor — --yui-input-bottom on the chat form", () => {
  let mount: HTMLElement;
  let s: ReturnType<typeof createSurfaces>;

  beforeEach(() => {
    ({ s, mount } = makeSurfaces());
  });

  afterEach(() => {
    s.dispose();
    mount.remove();
  });

  function form(): HTMLElement {
    return mount.querySelector(".yui-input") as HTMLElement;
  }

  it("sets --yui-input-bottom to a px value", () => {
    s.setInputAnchor(120);
    expect(form().style.getPropertyValue("--yui-input-bottom")).toBe("120px");
  });

  it("removes the var when given null", () => {
    s.setInputAnchor(120);
    s.setInputAnchor(null);
    expect(form().style.getPropertyValue("--yui-input-bottom")).toBe("");
  });

  it("preserves the var across summonInput()/dismissInput()", () => {
    s.setInputAnchor(96);
    s.summonInput();
    expect(form().style.getPropertyValue("--yui-input-bottom")).toBe("96px");
    s.dismissInput();
    expect(form().style.getPropertyValue("--yui-input-bottom")).toBe("96px");
  });
});

describe("setInputEnabled — disable the field while busy", () => {
  let mount: HTMLElement;
  let s: ReturnType<typeof createSurfaces>;

  beforeEach(() => {
    ({ s, mount } = makeSurfaces());
  });

  afterEach(() => {
    s.dispose();
    mount.remove();
  });

  function field(): HTMLInputElement {
    return mount.querySelector(".yui-input__field") as HTMLInputElement;
  }
  function form(): HTMLElement {
    return mount.querySelector(".yui-input") as HTMLElement;
  }

  it("disables the field and marks the form pending when disabled", () => {
    s.setInputEnabled(false);
    expect(field().disabled).toBe(true);
    expect(form().classList.contains("is-pending")).toBe(true);
  });

  it("re-enables the field and clears pending when enabled", () => {
    s.setInputEnabled(false);
    s.setInputEnabled(true);
    expect(field().disabled).toBe(false);
    expect(form().classList.contains("is-pending")).toBe(false);
  });
});
