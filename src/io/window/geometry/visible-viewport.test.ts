import { describe, expect, it, vi } from "vitest";
import type { ScreenMonitor } from "./screen-geometry";
import { createVisibleViewport, visibleViewportHeightPx } from "./visible-viewport";

describe("visibleViewportHeightPx", () => {
  it("is the full height when the window is fully on screen", () => {
    expect(visibleViewportHeightPx({ y: 100, height: 600 }, 1117)).toBe(600);
  });

  it("drops the part that hangs below the work area", () => {
    expect(visibleViewportHeightPx({ y: 712, height: 600 }, 1117)).toBe(405);
  });

  it("is 0 when the window is entirely below the work area", () => {
    expect(visibleViewportHeightPx({ y: 1200, height: 600 }, 1117)).toBe(0);
  });
});

describe("createVisibleViewport", () => {
  const monitor: ScreenMonitor = {
    position: { x: 0, y: 0 },
    size: { width: 1728, height: 1117 },
    workArea: { position: { x: 0, y: 33 }, size: { width: 1728, height: 1084 } },
    scaleFactor: 1,
  };

  function makeWindow(position: { x: number; y: number } = { x: 100, y: 712 }) {
    return {
      outerPosition: vi.fn(async () => position),
      outerSize: async () => ({ width: 400, height: 600 }),
      scaleFactor: async () => 1,
    };
  }

  it("reads Infinity until the first refresh, then the visible height", async () => {
    const viewport = createVisibleViewport(makeWindow(), async () => [monitor]);

    expect(viewport.get()).toBe(Number.POSITIVE_INFINITY);
    await viewport.refresh();
    expect(viewport.get()).toBe(405);
  });

  it("stays Infinity when no monitor holds the window's top-left", async () => {
    const viewport = createVisibleViewport(makeWindow({ x: -500, y: 712 }), async () => [monitor]);

    await viewport.refresh();
    expect(viewport.get()).toBe(Number.POSITIVE_INFINITY);
  });

  it("keeps the cached height when a window read rejects", async () => {
    const win = makeWindow();
    const viewport = createVisibleViewport(win, async () => [monitor]);
    await viewport.refresh();
    win.outerPosition.mockRejectedValueOnce(new Error("window gone"));

    await expect(viewport.refresh()).resolves.toBeUndefined();
    expect(viewport.get()).toBe(405);
  });
});
