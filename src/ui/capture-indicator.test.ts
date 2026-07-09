// @vitest-environment jsdom

/**
 * capture-indicator.test.ts — 프라이버시 a11y.
 * 캡처가 꺼지면 pill이 접근성 트리에서도 빠져야 한다(el.hidden), 시각만 숨기지 않는다.
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
    // hide는 페이드가 끝난 뒤 트리에서 제거한다(POLISH A). 전이 완료를 흘려보낸다.
    ind.el.dispatchEvent(new TransitionEvent("transitionend", { propertyName: "opacity" }));
    expect(ind.el.hidden).toBe(true);

    s.emit(true);
    expect(ind.el.hidden).toBe(false);
  });

  it("defers hidden=true until the fade-out settles (does not cut the transition)", () => {
    // beforeEach의 즉시-rAF 하에서: hidden 제거를 rAF(다음 프레임)로 미루면
    // 페이드(200ms)보다 짧아 잘린다. emit 직후에도 트리에 남아있어야 한다.
    const s = fakeSettings(true);
    const ind = createCaptureIndicator({ mount, settings: s.store, onActivate: () => {} });
    expect(ind.el.hidden).toBe(false);

    s.emit(false);
    // 전이 중: is-visible은 제거됐지만 아직 접근성 트리에 남아 페이드가 재생된다.
    expect(ind.el.classList.contains("is-visible")).toBe(false);
    expect(ind.el.hidden).toBe(false);

    // opacity transitionend가 뜨면 그제서야 트리에서 제거된다.
    ind.el.dispatchEvent(new TransitionEvent("transitionend", { propertyName: "opacity" }));
    expect(ind.el.hidden).toBe(true);
  });

  it("falls back to a timer (not a frame) when no transitionend fires", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const s = fakeSettings(true);
    const ind = createCaptureIndicator({ mount, settings: s.store, onActivate: () => {} });

    s.emit(false);
    // 전이가 아예 없는 환경: 폴백 타이머만이 트리에서 제거한다.
    expect(ind.el.hidden).toBe(false);
    vi.advanceTimersByTime(400);
    expect(ind.el.hidden).toBe(true);
    vi.useRealTimers();
  });
});
