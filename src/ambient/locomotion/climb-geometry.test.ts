import { describe, expect, it } from "vitest";
import type { ScreenMonitor } from "../../io/window/screen-geometry";
import {
  type ClimbTarget,
  climbGeometrySample,
  climbTargetLost,
  ledgeSeatX,
  nextClimbDelay,
  nextDwell,
  pickClimbTarget,
  pickDescentTarget,
  pickMonitorWalls,
} from "./climb-geometry";
import {
  ANCHOR,
  CFG,
  CHAR_HPX,
  COLUMN_COVER,
  RIGHT_COLUMN_COVER,
  TARGET,
  TARGET_WINDOW,
  win,
} from "./test-helpers";

const MONITOR_BOUNDS = { x: 0, y: 0, width: 1920, height: 1600 };

/** Bottom edge flush with the target's top edge: the column is clear, the corner seat is not. */
const SEAT_COVER = win({ x: 1000, y: 800, width: 100, height: 100, windowNumber: 7 });

describe("pickClimbTarget", () => {
  const base = {
    feetX: 700,
    floor: 1500,
    workTop: 100,
    charHpx: CHAR_HPX,
    anchorY: ANCHOR.y,
    monitor: MONITOR_BOUNDS,
    cfg: CFG,
    maxWalkPx: 600,
  };

  it("takes the side edge nearest the feet on an eligible window", () => {
    expect(pickClimbTarget({ ...base, windows: [TARGET_WINDOW] })).toEqual(TARGET);
  });

  it("skips a wall the descent column would not fit beside", () => {
    // Left edge at 200: the 150 px climb column fits, the 300 px descent column runs off.
    const nearEdge = win({ x: 200, width: 400 });
    expect(pickClimbTarget({ ...base, feetX: 250, windows: [nearEdge] })?.side).toBe("right");
  });

  it("takes the right edge when that is the nearer one", () => {
    expect(pickClimbTarget({ ...base, feetX: 1500, windows: [TARGET_WINDOW] })).toEqual({
      ...TARGET,
      side: "right",
      edgeX: 1400,
    });
  });

  it("takes the nearest edge across several eligible windows", () => {
    const near = win({ x: 780, width: 200, windowNumber: 7 });
    const picked = pickClimbTarget({ ...base, windows: [TARGET_WINDOW, near] });
    expect(picked?.windowNumber).toBe(7);
    expect(picked?.edgeX).toBe(780);
  });

  it("rejects a window whose bottom edge is out of reach", () => {
    // Bottom 980 sits more than one character height above the floor.
    expect(pickClimbTarget({ ...base, windows: [win({ y: 600, height: 380 })] })).toBeNull();
  });

  it("rejects a window shorter than half a character", () => {
    expect(pickClimbTarget({ ...base, windows: [win({ y: 1100, height: 200 })] })).toBeNull();
  });

  it("rejects a window taller than max_height_frac characters", () => {
    expect(pickClimbTarget({ ...base, windows: [win({ y: 600, height: 2100 })] })).toBeNull();
  });

  it("rejects a top edge the pet window cannot reach past the work-area top", () => {
    // The OS clamps the window origin to the work-area top, so a top edge less than one
    // feet-offset below it can never take the feet: 519 - 420 = 99 < 100.
    expect(pickClimbTarget({ ...base, windows: [win({ y: 519, height: 981 })] })).toBeNull();
  });

  it("accepts a top edge exactly one feet-offset below the work-area top", () => {
    // 520 - 420 = 100 — grounds the standing room in the feet offset, not the height.
    expect(pickClimbTarget({ ...base, windows: [win({ y: 520, height: 980 })] })?.topY).toBe(520);
  });

  it("rejects an edge whose wall column is covered by a window in front", () => {
    expect(pickClimbTarget({ ...base, windows: [COLUMN_COVER, TARGET_WINDOW] })).toBeNull();
  });

  it("takes the far edge when only the near one's wall column is covered", () => {
    const picked = pickClimbTarget({
      ...base,
      maxWalkPx: 800,
      windows: [COLUMN_COVER, TARGET_WINDOW],
    });
    expect(picked).toEqual({ ...TARGET, side: "right", edgeX: 1400 });
  });

  it("rejects an edge whose corner seat is covered by a window in front", () => {
    expect(pickClimbTarget({ ...base, windows: [SEAT_COVER, TARGET_WINDOW] })).toBeNull();
  });

  it("checks the column she stands in, outside the edge — not a band straddling it", () => {
    // Inside the target's own face (1010..1100) is not her column: she stands at
    // 1000 - 75 and reaches in, so only 850..1000 has to be clear.
    const inside = win({ x: 1010, y: 1300, width: 90, height: 200, windowNumber: 7 });
    expect(pickClimbTarget({ ...base, windows: [inside, TARGET_WINDOW] })).toEqual(TARGET);

    const outside = win({ x: 900, y: 1300, width: 90, height: 200, windowNumber: 7 });
    expect(pickClimbTarget({ ...base, windows: [outside, TARGET_WINDOW] })).toBeNull();
  });

  it("skips an edge whose stand column hangs off the screen", () => {
    // Left edge 100: she would stand at 100 - 75 with a 150 wide column reaching to -50.
    const atEdge = win({ x: 100, width: 400 });
    const picked = pickClimbTarget({ ...base, feetX: 200, windows: [atEdge] });
    expect(picked?.side).toBe("right");
    expect(picked?.edgeX).toBe(500);
  });

  it("rejects a window whose every wall hangs off the screen", () => {
    const spanning = win({ x: 100, width: 1750 });
    expect(
      pickClimbTarget({ ...base, feetX: 700, maxWalkPx: 2000, windows: [spanning] }),
    ).toBeNull();
  });

  it("rejects a window on another monitor", () => {
    expect(
      pickClimbTarget({
        ...base,
        monitor: { x: 0, y: 0, width: 900, height: 1600 },
        windows: [TARGET_WINDOW],
      }),
    ).toBeNull();
  });

  it("rejects an edge further away than the longest walk", () => {
    expect(pickClimbTarget({ ...base, maxWalkPx: 200, windows: [TARGET_WINDOW] })).toBeNull();
  });

  it("returns null when there are no windows", () => {
    expect(pickClimbTarget({ ...base, windows: [] })).toBeNull();
  });
});

describe("pickDescentTarget", () => {
  const base = {
    windows: [TARGET_WINDOW],
    windowNumber: 42,
    floor: 1500,
    charHpx: CHAR_HPX,
    monitor: MONITOR_BOUNDS,
    cfg: CFG,
  };

  it("takes the far edge when the nearer one's wall hangs off the screen", () => {
    // A window against the left of the screen: standing outside its left edge would put
    // her feet at 37 - 75, off the monitor entirely.
    const atEdge = win({ x: 37, width: 603 });
    const picked = pickDescentTarget({ ...base, windows: [atEdge], feetX: 271 });
    expect(picked?.side).toBe("right");
    expect(picked?.edgeX).toBe(640);
  });

  it("measures the screen fit with the descent reach, not the climb's", () => {
    // Left edge at 200: the 150 px climb column fits, the 300 px descent column runs off.
    const nearEdge = win({ x: 200, width: 440 });
    expect(pickDescentTarget({ ...base, windows: [nearEdge], feetX: 250 })?.side).toBe("right");
  });

  it("returns null when neither wall leaves room on the screen", () => {
    const spanning = win({ x: 37, width: 1863 });
    expect(pickDescentTarget({ ...base, windows: [spanning], feetX: 271 })).toBeNull();
  });

  it("takes the nearer edge of the window the perch is armed on", () => {
    expect(pickDescentTarget({ ...base, feetX: 1050 })).toEqual(TARGET);
    expect(pickDescentTarget({ ...base, feetX: 1350 })).toEqual({
      ...TARGET,
      side: "right",
      edgeX: 1400,
    });
  });

  it("takes the armed window rather than whatever the feet hang over", () => {
    // In the sit pose the feet dangle below the ledge, so geometry alone would miss it.
    const other = win({ x: 200, width: 400, windowNumber: 7 });
    expect(pickDescentTarget({ ...base, windows: [other, TARGET_WINDOW], feetX: 1050 })).toEqual(
      TARGET,
    );
  });

  it("takes the far edge when the nearer one's wall is covered", () => {
    expect(
      pickDescentTarget({ ...base, windows: [COLUMN_COVER, TARGET_WINDOW], feetX: 1050 }),
    ).toEqual({ ...TARGET, side: "right", edgeX: 1400 });
  });

  it("returns null when both walls are covered", () => {
    expect(
      pickDescentTarget({
        ...base,
        windows: [COLUMN_COVER, RIGHT_COLUMN_COVER, TARGET_WINDOW],
        feetX: 1050,
      }),
    ).toBeNull();
  });

  it("returns null when the armed window is gone from the stack", () => {
    expect(pickDescentTarget({ ...base, windowNumber: 7, feetX: 1050 })).toBeNull();
    expect(pickDescentTarget({ ...base, windows: [], feetX: 1050 })).toBeNull();
  });
});

describe("pickMonitorWalls", () => {
  /** Built-in display: 1728×1117 logical at (0,0), scale 2 — top 50 logical / bottom
   *  margin 100 logical for a dock. */
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
  const base = {
    monitors: MONITORS,
    monitor: BUILTIN,
    floor: 1017,
    maxWalkPx: 600,
  };

  it("returns the left screen edge as a right-hand wall onto the monitor above", () => {
    expect(pickMonitorWalls({ ...base, feetX: 100 })).toEqual([
      {
        windowNumber: -1,
        side: "right",
        edgeX: 0,
        topY: 0,
        bottomY: 1017,
        width: 0,
        rect: { x: 0, y: 0 },
        app: null,
        title: null,
        kind: "monitor",
      },
    ]);
  });

  it("returns the right screen edge as a left-hand wall onto the monitor above", () => {
    expect(pickMonitorWalls({ ...base, feetX: 1600 })).toEqual([
      {
        windowNumber: -1,
        side: "left",
        edgeX: 1728,
        topY: 0,
        bottomY: 1017,
        width: 0,
        rect: { x: 1728, y: 0 },
        app: null,
        title: null,
        kind: "monitor",
      },
    ]);
  });

  it("returns nothing when no monitor sits above either edge", () => {
    // Both edges are within reach; only their upper monitors are missing.
    expect(pickMonitorWalls({ ...base, monitors: [BUILTIN], feetX: 864, maxWalkPx: 900 })).toEqual(
      [],
    );
  });

  it("returns nothing when both edges are farther than the longest walk", () => {
    expect(pickMonitorWalls({ ...base, feetX: 864, maxWalkPx: 100 })).toEqual([]);
  });
});

describe("ledgeSeatX", () => {
  it("walks in from a left edge by the drawn distance", () => {
    expect(ledgeSeatX(1000, "left", 1000, CHAR_HPX, 300)).toBe(1300);
  });

  it("walks in from a right edge the other way", () => {
    expect(ledgeSeatX(1400, "right", 1000, CHAR_HPX, 300)).toBe(1100);
  });

  it("keeps half a character clear of the far edge when the draw would overshoot", () => {
    // 800 wide against a 500 character: the seat stops 250 short of the far edge.
    expect(ledgeSeatX(1000, "left", 800, CHAR_HPX, 700)).toBe(1550);
    expect(ledgeSeatX(1800, "right", 800, CHAR_HPX, 700)).toBe(1250);
  });

  it("centres her on a window narrower than she is", () => {
    // 200 wide against a 500 character: half the window is the best that is left.
    expect(ledgeSeatX(1000, "left", 200, CHAR_HPX, 300)).toBe(1100);
    expect(ledgeSeatX(1200, "right", 200, CHAR_HPX, 300)).toBe(1100);
  });

  it("leaves a short draw alone", () => {
    expect(ledgeSeatX(1000, "left", 1000, CHAR_HPX, 120)).toBe(1120);
  });
});

describe("climbGeometrySample", () => {
  const base = {
    phase: "climb_up",
    topY: 900,
    win: { x: 725, y: 1080 },
    feet: { x: 200, y: 420 },
    hands: { left: { x: 260, y: 300 }, right: { x: 280, y: 260 } },
    hipsY: 320,
    clipT: 1.25,
    charHpx: CHAR_HPX,
  };

  it("carries the hips height and the clip playhead so the curve can be checked", () => {
    const s = climbGeometrySample({ ...base, side: "left", edgeX: 1000 });
    expect(s.hipsY).toBe(1400);
    expect(s.clipT).toBeCloseTo(1.25, 6);
  });

  it("reports a null playhead when no clip is running", () => {
    const s = climbGeometrySample({ ...base, side: "left", edgeX: 1000, clipT: null });
    expect(s.clipT).toBeNull();
  });

  it("reports every point in global logical px, rounded", () => {
    const s = climbGeometrySample({ ...base, side: "left", edgeX: 1000 });
    expect(s.phase).toBe("climb_up");
    expect(s.winX).toBe(725);
    expect(s.winY).toBe(1080);
    // Anchors are pet-window local: 725 + 200, 1080 + 420.
    expect(s.feetX).toBe(925);
    expect(s.feetY).toBe(1500);
    expect(s.handLX).toBe(985);
    expect(s.handLY).toBe(1380);
    expect(s.handRX).toBe(1005);
    expect(s.handRY).toBe(1340);
    expect(s.charHpx).toBe(CHAR_HPX);
  });

  it("rounds fractional projections", () => {
    const s = climbGeometrySample({
      ...base,
      side: "left",
      edgeX: 1000,
      feet: { x: 200.4, y: 420.6 },
    });
    expect(s.feetX).toBe(925);
    expect(s.feetY).toBe(1501);
  });

  it("measures a left wall with inside the window positive", () => {
    const s = climbGeometrySample({ ...base, side: "left", edgeX: 1000 });
    // Right hand at 1005 has reached 5 px past the edge into the face; feet are outside.
    expect(s.handRX).toBe(1005);
    expect(s.handR_dx).toBe(5);
    expect(s.handL_dx).toBe(-15);
    expect(s.feet_dx).toBe(-75);
  });

  it("flips the sign for a right wall so inside stays positive", () => {
    // Mirror geometry about a right edge at 1400: the same 5 px past the face.
    const s = climbGeometrySample({
      ...base,
      side: "right",
      edgeX: 1400,
      win: { x: 1475 - 200, y: 1080 },
      hands: { left: { x: 140, y: 300 }, right: { x: 120, y: 260 } },
    });
    expect(s.handRX).toBe(1395);
    expect(s.handR_dx).toBe(5);
    expect(s.handL_dx).toBe(-15);
    expect(s.feet_dx).toBe(-75);
  });
});

describe("nextClimbDelay / nextDwell", () => {
  it("draws inside the configured ranges", () => {
    expect(nextClimbDelay(CFG, () => 0)).toBe(90_000);
    expect(nextClimbDelay(CFG, () => 1)).toBe(180_000);
    expect(nextDwell(CFG, () => 0)).toBe(60_000);
    expect(nextDwell(CFG, () => 0.5)).toBe(90_000);
  });
});

describe("climbTargetLost", () => {
  const base = {
    target: TARGET,
    charHpx: CHAR_HPX,
    floor: 1500,
    cfg: CFG,
    direction: "up" as const,
  };

  it("holds while the target sits where it was", () => {
    expect(climbTargetLost({ ...base, windows: [TARGET_WINDOW] })).toBe(false);
  });

  it("loses a target that is gone from the stack", () => {
    expect(climbTargetLost({ ...base, windows: [] })).toBe(true);
  });

  it("loses a target that moved further than the jitter threshold", () => {
    expect(climbTargetLost({ ...base, windows: [win({ x: 1040 })] })).toBe(true);
    expect(climbTargetLost({ ...base, windows: [win({ x: 1006 })] })).toBe(false);
  });

  it("loses a target whose wall column was newly covered", () => {
    expect(climbTargetLost({ ...base, windows: [COLUMN_COVER, TARGET_WINDOW] })).toBe(true);
  });

  it("loses a target whose corner seat was newly covered", () => {
    expect(climbTargetLost({ ...base, windows: [SEAT_COVER, TARGET_WINDOW] })).toBe(true);
  });

  it("watches the wider descent column on the way down", () => {
    // 750..810 sits inside the descent column (700..1000) but outside the climb one (850..1000).
    const farCover = win({ x: 750, y: 1300, width: 60, height: 200, windowNumber: 7 });
    expect(climbTargetLost({ ...base, windows: [farCover, TARGET_WINDOW] })).toBe(false);
    expect(
      climbTargetLost({ ...base, direction: "down", windows: [farCover, TARGET_WINDOW] }),
    ).toBe(true);
  });

  it("never loses a monitor target — a screen edge cannot move, vanish or be covered", () => {
    const monitorTarget: ClimbTarget = {
      windowNumber: -1,
      side: "right",
      edgeX: 0,
      topY: 0,
      bottomY: 1500,
      width: 0,
      rect: { x: 0, y: 0 },
      app: null,
      title: null,
      kind: "monitor",
    };
    // Straddles the wall column at edgeX 0 — a window wall would call this covered.
    const cover = win({ x: 0, y: 0, width: 150, height: 100, windowNumber: 9 });
    expect(climbTargetLost({ ...base, target: monitorTarget, windows: [] })).toBe(false);
    expect(climbTargetLost({ ...base, target: monitorTarget, windows: [cover] })).toBe(false);
  });
});
