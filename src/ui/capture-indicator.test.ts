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
    expect(ind.el.hidden).toBe(true);

    s.emit(true);
    expect(ind.el.hidden).toBe(false);
  });
});
