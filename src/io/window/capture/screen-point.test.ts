import { describe, expect, it } from "vitest";
import type { ScreenMonitor } from "../geometry/screen-geometry";

describe("physicalToLogicalScreenPoint", () => {
  it("uses the containing monitor scale with mixed scales and negative origins", async () => {
    const { physicalToLogicalScreenPoint } = await import("./screen-point");
    const monitor = (
      x: number,
      y: number,
      width: number,
      height: number,
      scaleFactor: number,
    ): ScreenMonitor => ({
      position: { x, y },
      size: { width, height },
      scaleFactor,
      workArea: { position: { x, y }, size: { width, height } },
    });
    const monitors = [
      monitor(0, 0, 2000, 1200, 2),
      monitor(-2400, -400, 2400, 1600, 2),
      monitor(2000, 0, 1000, 800, 1),
    ];
    expect(physicalToLogicalScreenPoint({ x: 1000, y: 600 }, monitors)).toEqual({ x: 500, y: 300 });
    expect(physicalToLogicalScreenPoint({ x: -1200, y: -200 }, monitors)).toEqual({
      x: -600,
      y: -100,
    });
    expect(physicalToLogicalScreenPoint({ x: 2500, y: 400 }, monitors)).toEqual({
      x: 2500,
      y: 400,
    });
  });
});
