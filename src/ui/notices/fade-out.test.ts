// @vitest-environment jsdom

/**
 * fade-out.test.ts — the settle contract shared by every fading surface.
 * Settle runs exactly once, and the listener never outlives it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { afterFadeOut } from "./fade-out.ts";

// jsdom has no TransitionEvent constructor, so attach propertyName by hand.
function transitionEnd(el: HTMLElement, propertyName = "opacity"): void {
  const e = new Event("transitionend") as Event & { propertyName: string };
  e.propertyName = propertyName;
  el.dispatchEvent(e);
}

describe("afterFadeOut", () => {
  let el: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    el = document.createElement("div");
    document.body.append(el);
  });

  afterEach(() => {
    vi.useRealTimers();
    el.remove();
  });

  it("settles on the opacity transitionend", () => {
    const settle = vi.fn();
    afterFadeOut(el, settle);
    expect(settle).not.toHaveBeenCalled();

    transitionEnd(el);
    expect(settle).toHaveBeenCalledTimes(1);
  });

  it("ignores transitions of other properties", () => {
    const settle = vi.fn();
    afterFadeOut(el, settle);

    transitionEnd(el, "transform");
    expect(settle).not.toHaveBeenCalled();
  });

  it("settles from the default 400ms fallback timer when no transition fires", () => {
    const settle = vi.fn();
    afterFadeOut(el, settle);

    vi.advanceTimersByTime(399);
    expect(settle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(settle).toHaveBeenCalledTimes(1);
  });

  it("accepts a longer fallback for a caller whose own transition outlasts the default", () => {
    const settle = vi.fn();
    afterFadeOut(el, settle, 900);

    vi.advanceTimersByTime(899);
    expect(settle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(settle).toHaveBeenCalledTimes(1);
  });

  it("settles once — the fallback does not fire after a transitionend", () => {
    const settle = vi.fn();
    afterFadeOut(el, settle);

    transitionEnd(el);
    vi.advanceTimersByTime(1000);
    transitionEnd(el);
    expect(settle).toHaveBeenCalledTimes(1);
  });

  it("removes its listener after the fallback settles", () => {
    const settle = vi.fn();
    afterFadeOut(el, settle);

    vi.advanceTimersByTime(400);
    transitionEnd(el);
    expect(settle).toHaveBeenCalledTimes(1);
  });

  it("returns a cancel handle that stops the fallback timer from settling", () => {
    const settle = vi.fn();
    const cancel = afterFadeOut(el, settle);

    cancel();
    vi.advanceTimersByTime(400);
    expect(settle).not.toHaveBeenCalled();
  });

  it("cancel also stops a later transitionend from settling", () => {
    const settle = vi.fn();
    const cancel = afterFadeOut(el, settle);

    cancel();
    transitionEnd(el);
    expect(settle).not.toHaveBeenCalled();
  });
});
