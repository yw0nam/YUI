// @vitest-environment jsdom

/**
 * capture-indicator.test.ts — privacy a11y.
 * When capture is off, the pill must also leave the accessibility tree (el.hidden),
 * not just be visually hidden.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./capture-indicator.css", () => ({}));

import { createCaptureIndicator } from "./capture-indicator";

function fakeSettings(initial: boolean) {
  let cb: ((s: { enabled: boolean }) => void) | null = null;
  return {
    store: {
      get: () => ({ enabled: initial }),
      subscribe: (fn: (s: { enabled: boolean }) => void) => {
        cb = fn;
        return () => {};
      },
    } as unknown as Parameters<typeof createCaptureIndicator>[0]["settings"],
    emit: (enabled: boolean) => cb?.({ enabled }),
  };
}

describe("capture-indicator — a11y visibility", () => {
  let mount: HTMLElement;

  beforeEach(() => {
    let rafId = 0;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((f) => {
      f(0);
      return ++rafId;
    });
    mount = document.createElement("div");
    document.body.appendChild(mount);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("is hidden from the a11y tree when capture is disabled", () => {
    const s = fakeSettings(false);
    const ind = createCaptureIndicator({ mount, settings: s.store, onActivate: () => {} });
    expect(ind.el.hidden).toBe(true);
  });

  it("is present in the a11y tree when capture is enabled", () => {
    const s = fakeSettings(true);
    const ind = createCaptureIndicator({ mount, settings: s.store, onActivate: () => {} });
    expect(ind.el.hidden).toBe(false);
  });

  it("toggles el.hidden when the settings store flips", () => {
    const s = fakeSettings(true);
    const ind = createCaptureIndicator({ mount, settings: s.store, onActivate: () => {} });
    expect(ind.el.hidden).toBe(false);

    s.emit(false);
    // hide removes it from the tree after the fade completes (POLISH A). Flush the transition end.
    ind.el.dispatchEvent(new TransitionEvent("transitionend", { propertyName: "opacity" }));
    expect(ind.el.hidden).toBe(true);

    s.emit(true);
    expect(ind.el.hidden).toBe(false);
  });

  it("defers hidden=true until the fade-out settles (does not cut the transition)", () => {
    // Under beforeEach's immediate rAF: deferring hidden removal to a rAF (next frame)
    // is shorter than the fade (200ms), so it would cut it off. It must stay in the tree right after emit.
    const s = fakeSettings(true);
    const ind = createCaptureIndicator({ mount, settings: s.store, onActivate: () => {} });
    expect(ind.el.hidden).toBe(false);

    s.emit(false);
    // Mid-transition: is-visible is removed but it stays in the a11y tree so the fade plays.
    expect(ind.el.classList.contains("is-visible")).toBe(false);
    expect(ind.el.hidden).toBe(false);

    // Only once the opacity transitionend fires is it removed from the tree.
    ind.el.dispatchEvent(new TransitionEvent("transitionend", { propertyName: "opacity" }));
    expect(ind.el.hidden).toBe(true);
  });

  it("falls back to a timer (not a frame) when no transitionend fires", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const s = fakeSettings(true);
    const ind = createCaptureIndicator({ mount, settings: s.store, onActivate: () => {} });

    s.emit(false);
    // Environment with no transitions at all: only the fallback timer removes it from the tree.
    expect(ind.el.hidden).toBe(false);
    vi.advanceTimersByTime(900);
    expect(ind.el.hidden).toBe(true);
    vi.useRealTimers();
  });
});
