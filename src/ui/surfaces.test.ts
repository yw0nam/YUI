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
