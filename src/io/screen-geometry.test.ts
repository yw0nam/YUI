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
  floorSegments,
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

describe("floorSegments", () => {
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
    expect(floorSegments([LEFT], LEFT, 0, 0)).toEqual([{ left: 0, right: 1920 }]);
  });

  it("merges a same-floor, same-scale neighbour that touches it", () => {
    expect(floorSegments([LEFT, NEIGHBOUR], LEFT, 0, 0)).toEqual([{ left: 0, right: 3840 }]);
  });

  it("does not merge a monitor with a different floor line", () => {
    expect(floorSegments([LEFT, DIFFERENT_FLOOR], LEFT, 0, 0)).toEqual([{ left: 0, right: 1920 }]);
  });

  it("does not merge a monitor with a different scale factor", () => {
    expect(floorSegments([LEFT, DIFFERENT_SCALE], LEFT, 0, 0)).toEqual([{ left: 0, right: 1920 }]);
  });

  it("does not merge a same-floor monitor that is not horizontally contiguous", () => {
    expect(floorSegments([LEFT, GAPPED], LEFT, 0, 0)).toEqual([{ left: 0, right: 1920 }]);
  });

  it("chains a merge across three monitors", () => {
    // THIRD only touches the span once NEIGHBOUR has been absorbed, so this order
    // fails after a single forward pass and needs the repeat to find it.
    expect(floorSegments([LEFT, THIRD, NEIGHBOUR], LEFT, 0, 0)).toEqual([{ left: 0, right: 5120 }]);
  });

  it("shrinks the right edge by the window width", () => {
    expect(floorSegments([LEFT], LEFT, 400, 0)).toEqual([{ left: 0, right: 1520 }]);
  });

  describe("cutting for a monitor below the hang", () => {
    /** Built-in: 1728×1117 logical at (0,0), scale 2 — sits directly under the row above. */
    const BUILTIN: ScreenMonitor = {
      position: { x: 0, y: 0 },
      size: { width: 3456, height: 2234 },
      workArea: { position: { x: 0, y: 100 }, size: { width: 3456, height: 1934 } },
      scaleFactor: 2,
    };
    /** 1920×1080 logical at (−992, −1080), scale 1 — floor line (no dock) at y = 0. */
    const UPPER_LEFT: ScreenMonitor = {
      position: { x: -992, y: -1080 },
      size: { width: 1920, height: 1080 },
      workArea: { position: { x: -992, y: -1055 }, size: { width: 1920, height: 1055 } },
      scaleFactor: 1,
    };
    /** 1920×1080 logical at (928, −1080), scale 1 — floor line (no dock) at y = 0. */
    const UPPER_RIGHT: ScreenMonitor = {
      position: { x: 928, y: -1080 },
      size: { width: 1920, height: 1080 },
      workArea: { position: { x: 928, y: -1055 }, size: { width: 1920, height: 1055 } },
      scaleFactor: 1,
    };
    const MONITORS = [BUILTIN, UPPER_LEFT, UPPER_RIGHT];

    it("removes the stretch where a 400 px window's hang would overlap the monitor below", () => {
      expect(floorSegments(MONITORS, UPPER_LEFT, 400, 153)).toEqual([
        { left: -992, right: -400 },
        { left: 1728, right: 2448 },
      ]);
    });

    it("does not cut when the window casts no hang below the floor", () => {
      expect(floorSegments(MONITORS, UPPER_LEFT, 400, 0)).toEqual([{ left: -992, right: 2448 }]);
    });

    it("does not cut a monitor whose top sits below the hang band", () => {
      const FAR_BELOW: ScreenMonitor = { ...BUILTIN, position: { x: 0, y: 400 } };
      expect(floorSegments([FAR_BELOW, UPPER_LEFT, UPPER_RIGHT], UPPER_LEFT, 400, 153)).toEqual([
        { left: -992, right: 2448 },
      ]);
    });

    it("does not cut a monitor whose top sits exactly at the hang band's far edge", () => {
      // Logical top 153 (physical 306 at scale 2) == floor (0) + hangPx (153), excluded.
      const AT_BOUNDARY: ScreenMonitor = { ...BUILTIN, position: { x: 0, y: 306 } };
      expect(floorSegments([AT_BOUNDARY, UPPER_LEFT, UPPER_RIGHT], UPPER_LEFT, 400, 153)).toEqual([
        { left: -992, right: 2448 },
      ]);
    });

    it("cuts around two separate lower monitors of a different scale into three segments", () => {
      const SIDE: ScreenMonitor = {
        position: { x: 4600, y: 0 },
        size: { width: 100, height: 2234 },
        workArea: { position: { x: 4600, y: 100 }, size: { width: 100, height: 1934 } },
        scaleFactor: 2,
      };
      expect(floorSegments([BUILTIN, SIDE, UPPER_LEFT, UPPER_RIGHT], UPPER_LEFT, 400, 153)).toEqual(
        [
          { left: -992, right: -400 },
          { left: 1728, right: 1900 },
          { left: 2350, right: 2448 },
        ],
      );
    });

    it("returns no segments when a monitor below covers the entire span", () => {
      const FULL_CUT: ScreenMonitor = {
        position: { x: -1200, y: 0 },
        size: { width: 6100, height: 2234 },
        workArea: { position: { x: -1200, y: 100 }, size: { width: 6100, height: 1934 } },
        scaleFactor: 2,
      };
      expect(floorSegments([FULL_CUT, UPPER_LEFT, UPPER_RIGHT], UPPER_LEFT, 400, 153)).toEqual([]);
    });

    it("does not cut a same-scale monitor stacked directly below — the flash is a backing-scale mismatch, not any overlap", () => {
      const UPPER: ScreenMonitor = {
        position: { x: 0, y: -1080 },
        size: { width: 1920, height: 1080 },
        workArea: { position: { x: 0, y: -1080 }, size: { width: 1920, height: 1080 } },
        scaleFactor: 1,
      };
      const LOWER: ScreenMonitor = {
        position: { x: 0, y: 0 },
        size: { width: 1920, height: 1080 },
        workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } },
        scaleFactor: 1,
      };
      expect(floorSegments([UPPER, LOWER], UPPER, 400, 100)).toEqual([{ left: 0, right: 1520 }]);
    });
  });
});
