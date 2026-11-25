import { afterEach, describe, expect, it, vi } from "vitest";
import { clampPixelRatio, watchPixelRatio } from "./pixel-ratio";

describe("clampPixelRatio", () => {
  it("passes through ratios at or below the cap", () => {
    expect(clampPixelRatio(1)).toBe(1);
    expect(clampPixelRatio(2)).toBe(2);
  });

  it("clamps HiDPI ratios above the cap to 2", () => {
    expect(clampPixelRatio(3)).toBe(2);
    expect(clampPixelRatio(2.5)).toBe(2);
  });
});

describe("watchPixelRatio", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports each new ratio and watches the query of the new one", () => {
    const listeners = new Map<string, () => void>();
    vi.stubGlobal("devicePixelRatio", 2);
    vi.stubGlobal("matchMedia", (query: string) => ({
      addEventListener: (_type: string, cb: () => void) => listeners.set(query, cb),
      removeEventListener: () => {},
    }));
    const onChange = vi.fn();

    watchPixelRatio(onChange);
    vi.stubGlobal("devicePixelRatio", 1);
    listeners.get("(resolution: 2dppx)")?.();
    vi.stubGlobal("devicePixelRatio", 1.5);
    listeners.get("(resolution: 1dppx)")?.();

    expect(onChange.mock.calls).toEqual([[1], [1.5]]);
  });
});
