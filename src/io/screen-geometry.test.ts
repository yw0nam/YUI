/**
 * screen-geometry.test.ts — the monitor/floor math shared by every window mover.
 *
 * Pure geometry: no Tauri, no renderer. The walker, the faller, the climber and the
 * avatar executor all place the window through these functions, so the floor line
 * is defined once.
 */

import { describe, expect, it } from "vitest";
import {
  floorPx,
  floorSpan,
  logicalWorkArea,
  monitorAt,
  type ScreenMonitor,
  toScreenMonitor,
} from "./screen-geometry";

/** Menu bar 25px tall, no dock. */
const LEFT: ScreenMonitor = {
  position: { x: 0, y: 0 },
  size: { width: 1920, height: 1080 },
  workArea: { position: { x: 0, y: 25 }, size: { width: 1920, height: 1030 } },
  scaleFactor: 1,
};

const RIGHT: ScreenMonitor = {
  position: { x: 1920, y: 0 },
  size: { width: 1280, height: 1024 },
  workArea: { position: { x: 1920, y: 0 }, size: { width: 1280, height: 1000 } },
  scaleFactor: 1,
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
    expect(floorPx(LEFT)).toBe(1055);
    expect(floorPx(RIGHT)).toBe(1000);
  });

  it("divides the physical bottom by the monitor's own scale factor", () => {
    const scaled: ScreenMonitor = { ...LEFT, scaleFactor: 2 };
    expect(floorPx(scaled)).toBe(527.5);
  });
});

describe("toScreenMonitor", () => {
  it("copies the bounds and the scale factor a Tauri monitor carries, dropping everything else", () => {
    const tauriMonitor = {
      name: "Built-in",
      scaleFactor: 2,
      position: { x: 0, y: 0 },
      size: { width: 1920, height: 1080 },
      workArea: { position: { x: 0, y: 25 }, size: { width: 1920, height: 1030 } },
    };
    expect(toScreenMonitor(tauriMonitor)).toEqual({ ...LEFT, scaleFactor: 2 });
  });
});

describe("logicalWorkArea", () => {
  it("divides the work area by the monitor's own scale factor", () => {
    const scaled: ScreenMonitor = {
      position: { x: 0, y: 0 },
      size: { width: 3840, height: 2160 },
      workArea: { position: { x: 0, y: 50 }, size: { width: 3840, height: 2060 } },
      scaleFactor: 2,
    };
    expect(logicalWorkArea(scaled)).toEqual({ x: 0, y: 25, width: 1920, height: 1030 });
  });
});

describe("floorSpan", () => {
  const NEIGHBOUR: ScreenMonitor = {
    position: { x: 1920, y: 0 },
    size: { width: 1920, height: 1080 },
    workArea: { position: { x: 1920, y: 25 }, size: { width: 1920, height: 1030 } },
    scaleFactor: 1,
  };
  /** Same floor line as LEFT/NEIGHBOUR, but a different scale factor. */
  const DIFFERENT_SCALE: ScreenMonitor = {
    ...NEIGHBOUR,
    position: { x: 3840, y: 0 },
    scaleFactor: 2,
    workArea: { position: { x: 1920, y: 50 }, size: { width: 1920, height: 2060 } },
  };
  /** Floor line 100 px below LEFT/NEIGHBOUR's — not the same floor. */
  const DIFFERENT_FLOOR: ScreenMonitor = {
    position: { x: 1920, y: 0 },
    size: { width: 1920, height: 1180 },
    workArea: { position: { x: 1920, y: 25 }, size: { width: 1920, height: 1130 } },
    scaleFactor: 1,
  };
  /** Same floor line, but a 200 px horizontal gap — not contiguous. */
  const GAPPED: ScreenMonitor = {
    position: { x: 2120, y: 0 },
    size: { width: 1920, height: 1080 },
    workArea: { position: { x: 2120, y: 25 }, size: { width: 1920, height: 1030 } },
    scaleFactor: 1,
  };
  /** A third monitor continuing the floor past NEIGHBOUR's own right edge. */
  const THIRD: ScreenMonitor = {
    position: { x: 3840, y: 0 },
    size: { width: 1280, height: 1080 },
    workArea: { position: { x: 3840, y: 25 }, size: { width: 1280, height: 1030 } },
    scaleFactor: 1,
  };

  it("starts with the monitor's own work-area x-range", () => {
    expect(floorSpan([LEFT], LEFT)).toEqual({ left: 0, right: 1920 });
  });

  it("merges a same-floor, same-scale neighbour that touches it", () => {
    expect(floorSpan([LEFT, NEIGHBOUR], LEFT)).toEqual({ left: 0, right: 3840 });
  });

  it("does not merge a monitor with a different floor line", () => {
    expect(floorSpan([LEFT, DIFFERENT_FLOOR], LEFT)).toEqual({ left: 0, right: 1920 });
  });

  it("does not merge a monitor with a different scale factor", () => {
    expect(floorSpan([LEFT, DIFFERENT_SCALE], LEFT)).toEqual({ left: 0, right: 1920 });
  });

  it("does not merge a same-floor monitor that is not horizontally contiguous", () => {
    expect(floorSpan([LEFT, GAPPED], LEFT)).toEqual({ left: 0, right: 1920 });
  });

  it("chains a merge across three monitors", () => {
    // THIRD only touches the span once NEIGHBOUR has been absorbed, so this order
    // fails after a single forward pass and needs the repeat to find it.
    expect(floorSpan([LEFT, THIRD, NEIGHBOUR], LEFT)).toEqual({ left: 0, right: 5120 });
  });
});
