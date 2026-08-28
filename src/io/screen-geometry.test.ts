/**
 * screen-geometry.test.ts — the monitor/floor math shared by every window mover.
 *
 * Pure geometry: no Tauri, no renderer. The walker, the faller and the avatar
 * executor all place the window through these four functions, so the floor line
 * is defined once.
 */

import { describe, expect, it } from "vitest";
import {
  floorPx,
  groundedWindowY,
  monitorAt,
  type ScreenMonitor,
  toScreenMonitor,
} from "./screen-geometry";

/** Menu bar 25px tall, no dock. */
const LEFT: ScreenMonitor = {
  position: { x: 0, y: 0 },
  size: { width: 1920, height: 1080 },
  workArea: { position: { x: 0, y: 25 }, size: { width: 1920, height: 1030 } },
};

const RIGHT: ScreenMonitor = {
  position: { x: 1920, y: 0 },
  size: { width: 1280, height: 1024 },
  workArea: { position: { x: 1920, y: 0 }, size: { width: 1280, height: 1000 } },
};

describe("monitorAt", () => {
  it("returns the monitor whose bounds contain the point", () => {
    expect(monitorAt([LEFT, RIGHT], 100, 100)).toBe(LEFT);
    expect(monitorAt([LEFT, RIGHT], 2000, 100)).toBe(RIGHT);
  });

  it("includes the top-left corner and excludes the far edges", () => {
    expect(monitorAt([LEFT], 0, 0)).toBe(LEFT);
    expect(monitorAt([LEFT], 1920, 0)).toBeNull();
    expect(monitorAt([LEFT], 0, 1080)).toBeNull();
  });

  it("returns null for a point on no monitor", () => {
    expect(monitorAt([LEFT, RIGHT], -10, 100)).toBeNull();
    expect(monitorAt([], 0, 0)).toBeNull();
  });
});

describe("floorPx", () => {
  it("reports the work-area bottom in logical px", () => {
    expect(floorPx(LEFT, 1)).toBe(1055);
    expect(floorPx(RIGHT, 1)).toBe(1000);
  });

  it("divides the physical bottom by the scale factor", () => {
    expect(floorPx(LEFT, 2)).toBe(527.5);
  });
});

describe("groundedWindowY", () => {
  it("puts the feet on the floor line", () => {
    expect(groundedWindowY(1055, 420, 1)).toBe(635);
  });

  it("returns a physical y, so a scaled screen doubles the offset", () => {
    expect(groundedWindowY(1055, 420, 2)).toBe(1270);
  });

  it("lets the window hang below the screen when the feet sit above its bottom", () => {
    expect(groundedWindowY(1000, 0, 1)).toBe(1000);
  });
});

describe("toScreenMonitor", () => {
  it("copies the bounds a Tauri monitor carries, dropping everything else", () => {
    const tauriMonitor = {
      name: "Built-in",
      scaleFactor: 2,
      position: { x: 0, y: 0 },
      size: { width: 1920, height: 1080 },
      workArea: { position: { x: 0, y: 25 }, size: { width: 1920, height: 1030 } },
    };
    expect(toScreenMonitor(tauriMonitor)).toEqual(LEFT);
  });
});
