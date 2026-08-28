import { describe, expect, it, vi } from "vitest";
import type { ClimbConfig, WalkConfig } from "../config/load";
import type { MotionKind, WindowRect } from "../contract";
import type { ScreenMonitor } from "../io/screen-geometry";
import type { RenderMotionSignal, TickContext, TickFn } from "../renderer";
import {
  CLIMB_DOWN_LANDING_MOTION_ID,
  CLIMB_DOWN_MOTION_ID,
  CLIMB_UP_DONE_MOTION_ID,
  CLIMB_UP_MOTION_ID,
  CLIMB_YAW_EASE_MS,
  CLIMB_YAW_RAD,
  type ClimberDeps,
  type ClimbTarget,
  climbGeometrySample,
  climbSpeedPxPerSec,
  climbTargetLost,
  createClimber,
  ledgeSeatX,
  nextClimbDelay,
  nextDwell,
  pickClimbTarget,
  pickDescentTarget,
} from "./climber";

const CFG: ClimbConfig = {
  interval_min_ms: 90_000,
  interval_max_ms: 180_000,
  perch_dwell_min_ms: 60_000,
  perch_dwell_max_ms: 120_000,
  max_height_frac: 4,
  hang_frac: 0.3,
  wall_offset_frac: 0.15,
  // rng () => 0 draws the minimum, so a ledge walk is 0.3 × 500 = 150 px in.
  ledge_walk_min_frac: 0.3,
  ledge_walk_max_frac: 1.5,
};

const WALK_CFG: WalkConfig = {
  interval_min_ms: 30_000,
  interval_max_ms: 60_000,
  distance_min_px: 200,
  distance_max_px: 600,
  floor_tolerance_px: 24,
};

/** Work area 100..1500 on a 1920×1600 screen ⇒ floor 1500, work top 100. */
const MONITOR: ScreenMonitor = {
  position: { x: 0, y: 0 },
  size: { width: 1920, height: 1600 },
  workArea: { position: { x: 0, y: 100 }, size: { width: 1920, height: 1400 } },
};
const MONITOR_BOUNDS = { x: 0, y: 0, width: 1920, height: 1600 };

const CHAR_HPX = 500;
/** Feet in canvas-local logical px. */
const ANCHOR = { x: 200, y: 420 };
const PX_PER_METRE = 300;
/** Pet window whose feet (500 + 200, 1080 + 420) stand at (700, 1500) — on the floor. */
const WINDOW_POS = { x: 500, y: 1080 };
/** Hand reach off the wall: the character stands this far outside the edge she climbs. */
const WALL_OFFSET = CFG.wall_offset_frac * CHAR_HPX;
/** Window x that stands her outside the target's left edge — 1000 - 75 - 200. */
const CLIMB_X = 1000 - WALL_OFFSET - ANCHOR.x;
/** Window x that stands her feet on the target's top-left corner — 1000 - 200. */
const CORNER_X = 1000 - ANCHOR.x;
/** How far in along the ledge she walks before sitting, at rng () => 0. */
const LEDGE_WALK = CFG.ledge_walk_min_frac * CHAR_HPX;
/** Window x with her feet on the seat, that far in from the target's left edge. */
const SEAT_WIN_X = 1000 + LEDGE_WALK - ANCHOR.x;
/** Where the up sequence leaves the window: seated in from the corner, level with the top. */
const PERCHED_POS = { x: SEAT_WIN_X, y: 480 };

function win(over: Partial<WindowRect> = {}): WindowRect {
  return {
    x: 1000,
    y: 900,
    width: 400,
    height: 600,
    name: "Meeting notes",
    ownerName: "Notes",
    pid: 11,
    windowNumber: 42,
    ...over,
  };
}

const TARGET_WINDOW = win();

/** Too short to climb itself, but it sits across the target's left wall column. */
const COLUMN_COVER = win({ x: 900, y: 1300, width: 200, height: 200, windowNumber: 7 });
/** The same, across the target's right wall column. */
const RIGHT_COLUMN_COVER = win({ x: 1300, y: 1300, width: 200, height: 200, windowNumber: 8 });
/** Bottom edge flush with the target's top edge: the column is clear, the corner seat is not. */
const SEAT_COVER = win({ x: 1000, y: 800, width: 100, height: 100, windowNumber: 7 });

const TARGET: ClimbTarget = {
  windowNumber: 42,
  side: "left",
  edgeX: 1000,
  topY: 900,
  bottomY: 1500,
  width: 400,
  rect: { x: 1000, y: 900 },
  app: "Notes",
  title: "Meeting notes",
};

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

describe("climbSpeedPxPerSec", () => {
  it("divides the clip's own stride by the cycle length it loops on", () => {
    expect(climbSpeedPxPerSec(300, 0.93, 2.967)).toBeCloseTo((300 * 0.93) / 2.967, 6);
  });

  it("scales linearly with the framing so the hands never slide", () => {
    expect(climbSpeedPxPerSec(600, 0.93, 2.967)).toBeCloseTo(
      climbSpeedPxPerSec(300, 0.93, 2.967) * 2,
      6,
    );
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
  const base = { target: TARGET, charHpx: CHAR_HPX, floor: 1500, cfg: CFG };

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
});

// ── runtime loop ──────────────────────────────────────────────────────────────

/** Source clip lengths the renderer reports once the clips are cached. */
const MOTION_S: Record<string, number> = {
  climb_up: 2.967,
  climb_up_done: 3.8,
  climb_down: 2.0,
  climb_down_landing: 1.383,
};

/** Hips travel (m, signed) the renderer detrended out of each clip, measured off the assets. */
const MOTION_TRAVEL_M: Record<string, number> = {
  climb_up: 0.843,
  climb_up_done: 1.413,
  climb_down: -1.054,
  climb_down_landing: -0.237,
};

/** What the window has to supply for each transition clip, in px at PX_PER_METRE. */
const PULL_PX = PX_PER_METRE * MOTION_TRAVEL_M.climb_up_done;
const LAND_PX = PX_PER_METRE * -MOTION_TRAVEL_M.climb_down_landing;

/** Which clips loop, so the harness clock wraps them the way the mixer would. */
const MOTION_LOOPS = new Set(["climb_up", "climb_down", "walk", "idle"]);

const MOTION_KINDS: Record<string, MotionKind> = {
  idle: "ambient",
  walk: "reactive",
  climb_up: "reactive",
  climb_up_done: "oneshot",
  climb_down: "reactive",
  climb_down_landing: "oneshot",
  window_sit: "state",
  drag: "reactive",
  happy: "oneshot",
};

function makeHarness(
  over: {
    position?: { x: number; y: number };
    windows?: WindowRect[];
    perched?: boolean;
    peeking?: boolean;
    dragging?: boolean;
    busy?: boolean;
    reducedMotion?: boolean;
    /** null models an unloaded VRM. */
    anchor?: { x: number; y: number } | null;
    /** null models a probe the renderer cannot take. */
    charHpx?: number | null;
    pxPerMetre?: number | null;
    /** What the injected walker reports for every walk. */
    walkResult?: "arrived" | "lost";
    /** Per-walk outcomes in call order, for a sequence with more than one walk. */
    walkResults?: Array<"arrived" | "lost">;
    /** Models a release whose exit envelope has not come back through the dispatcher yet. */
    holdPerchOnRelease?: boolean;
    /** Models the OS clamping the window origin to the work-area top. */
    minY?: number;
    /** A clip the renderer can never measure — a dead asset, or one with no baked travel. */
    unmeasurable?: string;
    /** Overrides a clip's hips curve; default is a linear rise across the clip. */
    travelCurve?: (id: string, t: number) => number;
  } = {},
) {
  let tick: TickFn | null = null;
  /** Clips the renderer has loaded — nothing is measurable before it is in here. */
  const cached = new Set<string>();
  /** Clip-local playhead, reset by a fresh request and wrapped for looping clips. */
  let clipT = 0;
  const preloads: string[] = [];
  const motions: Array<RenderMotionSignal | null> = [];
  const yaws: Array<{ rad: number; easeMs: number }> = [];
  const positions: Array<{ x: number; y: number }> = [];
  const walkTargets: number[] = [];
  let pos = { ...(over.position ?? WINDOW_POS) };
  let windows = over.windows ?? [TARGET_WINDOW];
  let perched = over.perched ?? false;
  let currentMotion: { id: string; vrma_path: string } | null = {
    id: "idle",
    vrma_path: "/motions/calm.vrma",
  };
  const starts = vi.fn();
  const sits = vi.fn();
  const ends = vi.fn();
  const adoptSit = vi.fn((windowNumber: number) => {
    armed = { windowNumber };
  });
  const handAnchors = vi.fn(() => ({ left: { x: 260, y: 300 }, right: { x: 280, y: 260 } }));
  const drop = vi.fn();
  const walkerCancel = vi.fn();
  let armed: { windowNumber: number } | null = over.perched ? { windowNumber: 42 } : null;
  const armedSit = vi.fn(() => armed);
  const release = vi.fn(() => {
    armed = null;
    if (!over.holdPerchOnRelease) perched = false;
  });
  const visibilityListeners = new Set<() => void>();
  const doc = {
    visibilityState: "visible",
    addEventListener: (_t: "visibilitychange", cb: () => void) => {
      visibilityListeners.add(cb);
    },
    removeEventListener: (_t: "visibilitychange", cb: () => void) => {
      visibilityListeners.delete(cb);
    },
  };

  const deps: ClimberDeps = {
    renderer: {
      onTick: (fn) => {
        tick = fn;
        return () => {
          tick = null;
        };
      },
      playMotion: (m) => {
        motions.push(m);
        if (m) cached.add(m.id);
        currentMotion = m ? { id: m.id, vrma_path: `/motions/${m.id}.vrma` } : null;
        clipT = 0;
      },
      getCurrentMotion: () => currentMotion,
      getCurrentMotionTime: () => (currentMotion ? clipT : null),
      getMotionTravelAt: (id, t) => {
        if (!cached.has(id) || id === over.unmeasurable) return null;
        if (over.travelCurve) return over.travelCurve(id, t);
        // Default: the clip rises at a constant rate across its own length.
        const total = MOTION_TRAVEL_M[id] ?? 0;
        const duration = MOTION_S[id] ?? 1;
        return total * Math.min(Math.max(t, 0) / duration, 1);
      },
      getTapPoints: () => ({
        head: { x: 200, y: 100 },
        chest: { x: 200, y: 200 },
        hips: { x: 200, y: 320 },
        charHpx: over.charHpx ?? CHAR_HPX,
      }),
      // Both measurements read the clip cache, so they answer null until it is warm.
      getMotionDuration: (id) => (cached.has(id) ? (MOTION_S[id] ?? null) : null),
      getMotionTravelY: (id) =>
        cached.has(id) && id !== over.unmeasurable ? (MOTION_TRAVEL_M[id] ?? 0) : null,
      preloadMotion: async (id) => {
        preloads.push(id);
        cached.add(id);
      },
      setBodyYaw: (rad, easeMs) => {
        yaws.push({ rad, easeMs });
      },
      getPxPerMetre: () => (over.pxPerMetre === undefined ? PX_PER_METRE : over.pxPerMetre),
      getCharacterAnchor: () => (over.anchor === undefined ? ANCHOR : over.anchor),
      getPerchProbe: () => {
        const charHpx = over.charHpx === undefined ? CHAR_HPX : over.charHpx;
        return charHpx === null ? null : { seatPx: { x: 200, y: 300 }, charHpx };
      },
      getHandAnchors: handAnchors,
      isPerched: () => perched,
    },
    getWindow: () => ({
      outerPosition: async () => ({ ...pos }),
      outerSize: async () => ({ width: 400, height: 600 }),
      scaleFactor: async () => 1,
      setPositionPhysical: async (x, y) => {
        pos = { x, y: over.minY === undefined ? y : Math.max(y, over.minY) };
        positions.push({ ...pos });
      },
    }),
    listMonitors: async () => [MONITOR],
    listWindows: async () => windows,
    getConfig: () => CFG,
    getWalkConfig: () => WALK_CFG,
    currentMotionKind: () => (currentMotion ? (MOTION_KINDS[currentMotion.id] ?? null) : null),
    isPeeking: () => over.peeking ?? false,
    isDragging: () => over.dragging ?? false,
    isBusy: () => over.busy ?? false,
    reducedMotion: () => over.reducedMotion ?? false,
    walker: {
      walkTo: async (toX: number) => {
        const outcome =
          over.walkResults?.[walkTargets.length] ?? over.walkResult ?? ("arrived" as const);
        walkTargets.push(toX);
        if (outcome === "arrived") pos = { x: toX, y: pos.y };
        return outcome;
      },
      cancel: walkerCancel,
    },
    faller: { drop },
    dropSource: { adoptSit, armedSit, release },
    doc,
    onStart: starts,
    onSit: sits,
    onEnd: ends,
    rng: () => 0,
  };

  const climber = createClimber(deps);
  let elapsed = 0;
  const frame = async (dt = 0.1): Promise<void> => {
    elapsed += dt;
    if (currentMotion) {
      clipT += dt;
      const duration = MOTION_S[currentMotion.id];
      if (duration && MOTION_LOOPS.has(currentMotion.id) && clipT >= duration) clipT -= duration;
    }
    tick?.({ vrm: {} as never, dt, elapsed } as TickContext);
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };
  /** One frame to arm the interval, then one that lands past it. */
  const skipInterval = async (): Promise<void> => {
    await frame();
    await frame(91);
  };
  /** One frame to arm the dwell, then one that lands past it. */
  const skipDwell = async (): Promise<void> => {
    await frame();
    await frame(61);
  };
  const runFrames = async (n: number): Promise<void> => {
    for (let i = 0; i < n; i++) await frame();
  };
  /** Frames until the sequence reports its end, or give up. */
  const runToEnd = async (): Promise<void> => {
    for (let i = 0; i < 400 && ends.mock.calls.length === 0; i++) await frame();
  };

  return {
    climber,
    motions,
    yaws,
    positions,
    walkTargets,
    preloads,
    starts,
    sits,
    ends,
    adoptSit,
    armedSit,
    handAnchors,
    release,
    drop,
    walkerCancel,
    frame,
    skipInterval,
    skipDwell,
    runFrames,
    runToEnd,
    at: () => ({ ...pos }),
    setPos: (next: { x: number; y: number }) => {
      pos = { ...next };
    },
    setWindows: (next: WindowRect[]) => {
      windows = next;
    },
    setPerched: (next: boolean) => {
      perched = next;
      armed = next ? { windowNumber: 42 } : null;
    },
    setCurrentMotion: (m: { id: string; vrma_path: string } | null) => {
      currentMotion = m;
    },
    hide: () => {
      doc.visibilityState = "hidden";
      for (const cb of visibilityListeners) cb();
    },
    hasTick: () => tick !== null,
  };
}

describe("createClimber — up", () => {
  it("registers a tick hook on start and unregisters it on stop", () => {
    const h = makeHarness();
    expect(h.hasTick()).toBe(false);
    h.climber.start();
    expect(h.hasTick()).toBe(true);
    h.climber.stop();
    expect(h.hasTick()).toBe(false);
  });

  it("holds still until the armed interval elapses", async () => {
    const h = makeHarness();
    h.climber.start();
    await h.frame();
    await h.frame(60);
    expect(h.starts).not.toHaveBeenCalled();
  });

  it("walks to a hand's reach outside the wall, not onto the edge line", async () => {
    // Standing with the feet on the edge straddles it and puts the hands inside the
    // window's face; the reach is what decides where she stands.
    const h = makeHarness();
    h.climber.start();
    await h.skipInterval();
    expect(h.starts).toHaveBeenCalledWith("up", TARGET);
    expect(h.walkTargets).toEqual([CLIMB_X]);
    expect(h.yaws[0]).toEqual({ rad: CLIMB_YAW_RAD, easeMs: CLIMB_YAW_EASE_MS });
  });

  it("stands outside the other way for a right-hand wall", async () => {
    const h = makeHarness({ position: { x: 1300, y: 1080 } });
    h.climber.start();
    await h.skipInterval();
    expect(h.starts).toHaveBeenCalledWith("up", { ...TARGET, side: "right", edgeX: 1400 });
    // Outside means to the RIGHT of a right edge: 1400 + 75 - 200.
    expect(h.walkTargets).toEqual([1400 + WALL_OFFSET - ANCHOR.x]);
    expect(h.yaws[0]).toEqual({ rad: -CLIMB_YAW_RAD, easeMs: CLIMB_YAW_EASE_MS });
  });

  it("climbs the wall, pulls over the ledge and sits on the top edge", async () => {
    const h = makeHarness();
    h.climber.start();
    await h.skipInterval();
    await h.runToEnd();

    expect(h.motions).toEqual([{ id: CLIMB_UP_MOTION_ID }, { id: CLIMB_UP_DONE_MOTION_ID }]);
    expect(h.at()).toEqual(PERCHED_POS);
    for (const p of h.positions) {
      expect(p.x).toBeGreaterThanOrEqual(CLIMB_X);
      expect(p.x).toBeLessThanOrEqual(CORNER_X);
      expect(p.y).toBeGreaterThanOrEqual(PERCHED_POS.y);
      expect(p.y).toBeLessThanOrEqual(WINDOW_POS.y);
    }
    expect(h.yaws.at(-1)).toEqual({ rad: 0, easeMs: CLIMB_YAW_EASE_MS });
    expect(h.ends).toHaveBeenCalledWith("up");
    // Feet on the ledge: the top edge sits exactly the feet offset below the window origin.
    expect(h.sits).toHaveBeenCalledTimes(1);
    expect(h.sits.mock.calls[0][0]).toEqual(TARGET);
    expect(h.sits.mock.calls[0][1]).toBeCloseTo(ANCHOR.y, 6);
    expect(h.adoptSit).toHaveBeenCalledWith(42, { x: 1000, y: 900 }, CHAR_HPX);
  });

  it("hands the last stretch of the wall to the pull-over clip", async () => {
    const h = makeHarness();
    h.climber.start();
    await h.skipInterval();
    await h.runToEnd();
    // The pull-over covers exactly the travel the renderer detrended out of its clip;
    // the loop covers the rest of the 600 px rise.
    expect(h.preloads).toContain(CLIMB_UP_DONE_MOTION_ID);
    expect(h.positions.some((p) => Math.abs(p.y - (PERCHED_POS.y + PULL_PX)) < 1)).toBe(true);
  });

  it("paces the wall loop at the clip's own detrended travel per cycle", async () => {
    const h = makeHarness();
    h.climber.start();
    await h.skipInterval();
    // First frame of the loop leg: travel 0.843 m over a 2.967 s cycle at 300 px/m.
    const before = h.at().y;
    await h.frame(0.1);
    const expected = climbSpeedPxPerSec(PX_PER_METRE, MOTION_TRAVEL_M.climb_up, MOTION_S.climb_up);
    expect(before - h.at().y).toBeCloseTo(expected * 0.1, 0);
  });

  it("reads the ledge offset off where the window actually landed, not where it aimed", async () => {
    // The OS refuses to move the window above 600, so the intended 480 never happens.
    const h = makeHarness({ minY: 600 });
    h.climber.start();
    await h.skipInterval();
    await h.runToEnd();

    expect(h.at()).toEqual({ x: SEAT_WIN_X, y: 600 });
    expect(h.sits).toHaveBeenCalledTimes(1);
    expect(h.sits.mock.calls[0][1]).toBeCloseTo(TARGET.topY - 600, 6);
  });

  it("takes a transition leg's remaining travel when its oneshot clip ends first", async () => {
    const h = makeHarness();
    h.climber.start();
    await h.skipInterval();
    // Into the pull-over, then let the clip finish before its linear travel does.
    for (let i = 0; i < 400 && h.motions.length < 2; i++) await h.frame();
    expect(h.motions).toEqual([{ id: CLIMB_UP_MOTION_ID }, { id: CLIMB_UP_DONE_MOTION_ID }]);
    await h.runFrames(2);

    h.setCurrentMotion({ id: "idle", vrma_path: "/motions/calm.vrma" });
    await h.runFrames(1);
    // The leg completes instead of replaying the clip that just ended.
    expect(h.motions).toEqual([{ id: CLIMB_UP_MOTION_ID }, { id: CLIMB_UP_DONE_MOTION_ID }]);
    expect(h.at()).toEqual(PERCHED_POS);
    expect(h.sits).toHaveBeenCalledTimes(1);
  });

  it("pulls in over the corner during the pull-over so the sit lands on it", async () => {
    // She climbs the outer face a hand's reach out, then the pull-over carries her back
    // in over the edge — the mirror of the hang on the way down.
    const h = makeHarness();
    h.climber.start();
    await h.skipInterval();

    // Still out on the wall while the loop leg runs.
    await h.runFrames(2);
    expect(h.at().x).toBe(CLIMB_X);

    // Into the pull-over: x eases in and finishes on the corner.
    for (let i = 0; i < 400 && h.motions.length < 2; i++) await h.frame();
    await h.runFrames(2);
    const midway = h.at().x;
    expect(midway).toBeGreaterThan(CLIMB_X);
    expect(midway).toBeLessThan(CORNER_X);

    await h.runToEnd();
    // The last frame the leg moved: the ledge walk that follows is the walker's.
    expect(h.positions.at(-1)?.x).toBe(CORNER_X);
  });

  it("walks in along the ledge before it sits, so the seat is not on the corner", async () => {
    // Sitting on the corner leaves half of some sit clips hanging past the edge.
    const h = makeHarness();
    h.climber.start();
    await h.skipInterval();
    await h.runToEnd();

    expect(h.walkTargets).toEqual([CLIMB_X, SEAT_WIN_X]);
    expect(h.at()).toEqual(PERCHED_POS);
    expect(h.sits).toHaveBeenCalledTimes(1);
    expect(h.sits.mock.calls[0][1]).toBeCloseTo(ANCHOR.y, 6);
    expect(h.adoptSit).toHaveBeenCalledWith(42, { x: 1000, y: 900 }, CHAR_HPX);
  });

  it("walks in the other way along a right-hand ledge", async () => {
    const h = makeHarness({ position: { x: 1300, y: 1080 } });
    h.climber.start();
    await h.skipInterval();
    await h.runToEnd();
    // In from a right edge is leftward: 1400 - 150 - 200.
    expect(h.walkTargets.at(-1)).toBe(1400 - LEDGE_WALK - ANCHOR.x);
  });

  it("ends the climb without a sit when the ledge walk is lost", async () => {
    const h = makeHarness({ walkResults: ["arrived", "lost"] });
    h.climber.start();
    await h.skipInterval();
    await h.runToEnd();

    expect(h.walkTargets).toHaveLength(2);
    expect(h.ends).toHaveBeenCalledWith("up");
    expect(h.sits).not.toHaveBeenCalled();
    expect(h.adoptSit).not.toHaveBeenCalled();
  });

  it("follows the clip's own hips curve, not a straight line through it", async () => {
    // A pull-over that lifts 80% of its rise in the first third: the window has to be
    // front-loaded too, or the hands lead the ledge through the middle of the clip.
    const frontLoaded = (id: string, t: number): number => {
      const total = MOTION_TRAVEL_M[id] ?? 0;
      const duration = MOTION_S[id] ?? 1;
      const p = Math.min(Math.max(t, 0) / duration, 1);
      return total * (p <= 1 / 3 ? 0.8 * (p * 3) : 0.8 + 0.2 * ((p - 1 / 3) * 1.5));
    };
    const h = makeHarness({ travelCurve: frontLoaded });
    h.climber.start();
    await h.skipInterval();
    // Run to the start of the pull-over leg.
    for (let i = 0; i < 400 && h.motions.length < 2; i++) await h.frame();
    const startY = h.at().y;

    // A third of the way through the 3.8 s clip, 80% of the 423.9 px is already spent.
    await h.runFrames(13);
    const spent = startY - h.at().y;
    expect(spent).toBeGreaterThan(PULL_PX * 0.7);
    expect(spent).toBeLessThan(PULL_PX * 0.95);
  });

  it("accumulates travel across loop restarts so a long wall still lands", async () => {
    // A 980 px rise against a 253 px cycle: the loop leg spans more than two restarts.
    const tall = win({ y: 520, height: 980 });
    const h = makeHarness({ position: { x: 300, y: 1080 }, windows: [tall] });
    h.climber.start();
    await h.skipInterval();
    await h.runToEnd();

    // Feet on the ledge: window y = topY - anchor.y.
    expect(h.at().y).toBe(tall.y - ANCHOR.y);
    expect(h.sits).toHaveBeenCalledTimes(1);
  });

  it("samples the hands against the edge while it climbs", async () => {
    // The geometry log is diagnostic only, but it is how the wall offset gets tuned —
    // if the hand anchors stop being read there is nothing to tune from.
    const h = makeHarness();
    h.climber.start();
    await h.skipInterval();
    expect(h.handAnchors).toHaveBeenCalled();
    const atApproach = h.handAnchors.mock.calls.length;
    await h.runFrames(12);
    expect(h.handAnchors.mock.calls.length).toBeGreaterThan(atApproach);
  });

  it("gives up when the pull-over clip cannot be measured", async () => {
    const h = makeHarness({ unmeasurable: CLIMB_UP_DONE_MOTION_ID });
    h.climber.start();
    await h.skipInterval();
    await h.runFrames(5);

    expect(h.starts).toHaveBeenCalledWith("up", TARGET);
    expect(h.ends).toHaveBeenCalledWith("up");
    expect(h.motions).toEqual([]);
    expect(h.sits).not.toHaveBeenCalled();
  });

  it("never climbs under reduced motion", async () => {
    const h = makeHarness({ reducedMotion: true });
    h.climber.start();
    await h.skipInterval();
    await h.runFrames(20);
    expect(h.starts).not.toHaveBeenCalled();
    expect(h.motions).toEqual([]);
  });

  it.each([
    ["perched", { perched: true }],
    ["peeking", { peeking: true }],
    ["dragging", { dragging: true }],
    ["a turn is in flight", { busy: true }],
    ["the feet anchor is unavailable", { anchor: null }],
    ["the perch probe is unavailable", { charHpx: null }],
    ["the framing cannot be measured", { pxPerMetre: null }],
  ])("skips while %s", async (_label, blocker) => {
    const h = makeHarness(blocker);
    h.climber.start();
    await h.skipInterval();
    await h.runFrames(5);
    expect(h.starts).not.toHaveBeenCalledWith("up", expect.anything());
  });

  it("skips when the feet are not resting on the floor", async () => {
    const h = makeHarness({ position: { x: 500, y: 600 } });
    h.climber.start();
    await h.skipInterval();
    expect(h.starts).not.toHaveBeenCalled();
  });

  it("gives up when the approach walk is lost", async () => {
    const h = makeHarness({ walkResult: "lost" });
    h.climber.start();
    await h.skipInterval();
    await h.runFrames(5);
    expect(h.starts).toHaveBeenCalledWith("up", TARGET);
    expect(h.ends).toHaveBeenCalledWith("up");
    expect(h.motions).toEqual([]);
  });
});

describe("createClimber — interruption", () => {
  it("leaves the window where it is when a cancel lands mid-wall", async () => {
    const h = makeHarness();
    h.climber.start();
    await h.skipInterval();
    await h.runFrames(4);
    const held = h.at();
    expect(held.y).toBeLessThan(WINDOW_POS.y);

    h.climber.cancel();
    await h.runFrames(6);
    expect(h.at()).toEqual(held);
    expect(h.ends).toHaveBeenCalledWith("up");
    expect(h.sits).not.toHaveBeenCalled();
  });

  it("holds the window still under an express clip and reclaims it from the baseline", async () => {
    const h = makeHarness();
    h.climber.start();
    await h.skipInterval();
    await h.runFrames(3);
    const held = h.at();

    h.setCurrentMotion({ id: "happy", vrma_path: "/motions/happy.vrma" });
    await h.runFrames(4);
    expect(h.at()).toEqual(held);
    expect(h.ends).not.toHaveBeenCalled();

    h.setCurrentMotion({ id: "idle", vrma_path: "/motions/calm.vrma" });
    await h.runFrames(1);
    expect(h.motions.at(-1)).toEqual({ id: CLIMB_UP_MOTION_ID });
    await h.runFrames(3);
    expect(h.at().y).toBeLessThan(held.y);
  });

  it("cancels and drops when the target vanishes mid-climb", async () => {
    const h = makeHarness();
    h.climber.start();
    await h.skipInterval();
    await h.runFrames(3);
    h.setWindows([]);
    await h.runFrames(10);

    expect(h.drop).toHaveBeenCalledTimes(1);
    expect(h.ends).toHaveBeenCalledWith("up");
    expect(h.sits).not.toHaveBeenCalled();
  });

  it("cancels and drops when the wall column is covered mid-climb", async () => {
    const h = makeHarness();
    h.climber.start();
    await h.skipInterval();
    await h.runFrames(3);
    h.setWindows([COLUMN_COVER, TARGET_WINDOW]);
    await h.runFrames(10);
    expect(h.drop).toHaveBeenCalledTimes(1);
  });

  it("ends the climb and drops her off the wall when the document is hidden", async () => {
    // The renderer parks its rAF while hidden, so leaving her on the wall would strand
    // her there until the window comes back.
    const h = makeHarness();
    h.climber.start();
    await h.skipInterval();
    await h.runFrames(3);
    h.hide();
    expect(h.ends).toHaveBeenCalledWith("up");
    expect(h.drop).toHaveBeenCalledTimes(1);
  });

  it("does not drop anyone when the document hides with no climb running", async () => {
    const h = makeHarness();
    h.climber.start();
    await h.frame();
    h.hide();
    expect(h.drop).not.toHaveBeenCalled();
    expect(h.ends).not.toHaveBeenCalled();
  });
});

describe("createClimber — down", () => {
  function perchedHarness(over: Parameters<typeof makeHarness>[0] = {}) {
    return makeHarness({ position: PERCHED_POS, perched: true, ...over });
  }

  it("holds the perch until the dwell elapses", async () => {
    const h = perchedHarness();
    h.climber.start();
    await h.frame();
    await h.frame(50);
    expect(h.release).not.toHaveBeenCalled();
  });

  it("releases the perch and climbs down a sit it did not start", async () => {
    const h = perchedHarness();
    h.climber.start();
    await h.skipDwell();

    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.starts).toHaveBeenCalledWith("down", TARGET);
    expect(h.walkTargets).toEqual([CORNER_X]);
    expect(h.yaws[0]).toEqual({ rad: CLIMB_YAW_RAD, easeMs: CLIMB_YAW_EASE_MS });
  });

  it("waits for the released perch to clear before walking — a held perch drops the walk", async () => {
    const h = perchedHarness({ holdPerchOnRelease: true });
    h.climber.start();
    await h.skipDwell();
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.walkTargets).toEqual([]);

    await h.runFrames(3);
    expect(h.walkTargets).toEqual([]);

    h.setPerched(false);
    await h.runFrames(1);
    expect(h.walkTargets).toEqual([CORNER_X]);
  });

  it("gives up the descent when the perch never clears, and takes the sit back", async () => {
    // release() already disarmed the poll, so without re-adopting it nothing would ever
    // move her off the ledge again: every later dwell dies at armedSit() being null.
    const h = perchedHarness({ holdPerchOnRelease: true });
    h.climber.start();
    await h.skipDwell();
    await h.runFrames(15);
    expect(h.walkTargets).toEqual([]);
    expect(h.ends).toHaveBeenCalledWith("down");
    expect(h.motions).toEqual([]);
    expect(h.adoptSit).toHaveBeenCalledWith(42, { x: 1000, y: 900 }, CHAR_HPX);
  });

  it("retries the descent on the next dwell after a release that never came back", async () => {
    const h = perchedHarness({ holdPerchOnRelease: true });
    h.climber.start();
    await h.skipDwell();
    await h.runFrames(15);
    h.release.mockClear();

    // The re-adopted sit is a sit like any other — the dwell rearms behind it.
    await h.frame();
    await h.frame(61);
    expect(h.release).toHaveBeenCalledTimes(1);
  });

  it("leaves the perch released when a cancel interrupts the release wait", async () => {
    const h = perchedHarness({ holdPerchOnRelease: true });
    h.climber.start();
    await h.skipDwell();
    await h.runFrames(2);
    h.climber.cancel();
    await h.runFrames(2);
    expect(h.adoptSit).not.toHaveBeenCalled();
  });

  it("puts the feet on the ledge before walking, wherever the drop left the window", async () => {
    // A drag drop leaves the window where the user released it; the renderer only shifts
    // the model for the sit, so the window itself still has to be squared to the edge.
    const h = perchedHarness({ position: { x: 850, y: 560 } });
    h.climber.start();
    await h.skipDwell();

    // Feet on the top edge = window origin at topY - anchor.y, x left where it was.
    expect(h.positions[0]).toEqual({ x: 850, y: TARGET.topY - ANCHOR.y });
    expect(h.walkTargets).toEqual([CORNER_X]);
  });

  it("stays seated when the ledge leaves no room above the work-area top", async () => {
    // Top edge 480: the window would have to sit at 60, above the work area's 100.
    const h = perchedHarness({ windows: [win({ y: 480, height: 1020 })] });
    h.climber.start();
    await h.skipDwell();
    await h.runFrames(5);

    expect(h.release).not.toHaveBeenCalled();
    expect(h.starts).not.toHaveBeenCalled();
    expect(h.motions).toEqual([]);
  });

  it("descends the window the perch is armed on, not the one under the feet", async () => {
    const h = perchedHarness({
      windows: [win({ x: 200, width: 400, windowNumber: 7 }), TARGET_WINDOW],
    });
    h.climber.start();
    await h.skipDwell();
    expect(h.armedSit).toHaveBeenCalled();
    expect(h.starts).toHaveBeenCalledWith("down", TARGET);
  });

  it("descends the far wall when the nearer one is covered", async () => {
    const h = perchedHarness({ windows: [COLUMN_COVER, TARGET_WINDOW] });
    h.climber.start();
    await h.skipDwell();
    expect(h.starts).toHaveBeenCalledWith("down", { ...TARGET, side: "right", edgeX: 1400 });
  });

  it("stays seated when both walls are covered", async () => {
    const h = perchedHarness({ windows: [COLUMN_COVER, RIGHT_COLUMN_COVER, TARGET_WINDOW] });
    h.climber.start();
    await h.skipDwell();
    await h.runFrames(5);

    expect(h.release).not.toHaveBeenCalled();
    expect(h.starts).not.toHaveBeenCalled();
    expect(h.motions).toEqual([]);
  });

  it("hangs off the edge, descends the wall and lands on the floor", async () => {
    const h = perchedHarness();
    h.climber.start();
    await h.skipDwell();
    await h.runToEnd();

    expect(h.motions).toEqual([{ id: CLIMB_DOWN_MOTION_ID }, { id: CLIMB_DOWN_LANDING_MOTION_ID }]);
    // The hang carries her off the corner onto the outer face; the rest runs down it.
    expect(h.at()).toEqual({ x: CLIMB_X, y: 1080 });
    for (const p of h.positions) {
      expect(p.x).toBeGreaterThanOrEqual(CLIMB_X);
      expect(p.x).toBeLessThanOrEqual(SEAT_WIN_X);
      expect(p.y).toBeGreaterThanOrEqual(PERCHED_POS.y);
      expect(p.y).toBeLessThanOrEqual(1080);
    }
    // Only the hang moves x; once on the wall she stays on the outer face.
    const afterHang = h.positions.slice(5);
    for (const p of afterHang) expect(p.x).toBe(CLIMB_X);
    expect(h.yaws.at(-1)).toEqual({ rad: 0, easeMs: CLIMB_YAW_EASE_MS });
    expect(h.ends).toHaveBeenCalledWith("down");
    expect(h.drop).not.toHaveBeenCalled();
  });

  it("slides down by the hang fraction before the descent loop takes over", async () => {
    const h = perchedHarness();
    h.climber.start();
    await h.skipDwell();
    // The 400 ms hang covers 0.3 × 500 px; the first frames must not exceed it.
    await h.runFrames(4);
    expect(h.at().y).toBeCloseTo(PERCHED_POS.y + CFG.hang_frac * CHAR_HPX, 6);
  });

  it("carries her off the corner onto the outer face during the hang", async () => {
    // She walks the top to the corner, then the hang drops her onto the wall she climbs.
    const h = perchedHarness();
    h.climber.start();
    await h.skipDwell();
    expect(h.at().x).toBe(CORNER_X);

    await h.runFrames(2);
    const midway = h.at().x;
    expect(midway).toBeLessThan(CORNER_X);
    expect(midway).toBeGreaterThan(CLIMB_X);

    await h.runFrames(2);
    expect(h.at().x).toBe(CLIMB_X);
  });

  it("hands over to the faller when the window bottom hangs above the floor", async () => {
    const short = win({ height: 400 });
    const h = perchedHarness({ windows: [short] });
    h.climber.start();
    await h.skipDwell();
    await h.runToEnd();

    // The faller may snap the last stretch without a clip, so the descent loop has to
    // hand the body back to the baseline itself rather than stay frozen in the wall pose.
    expect(h.motions).toEqual([{ id: CLIMB_DOWN_MOTION_ID }, null]);
    // Feet stop at the window bottom (1300); the faller covers the rest.
    expect(h.at()).toEqual({ x: CLIMB_X, y: 880 });
    expect(h.drop).toHaveBeenCalledTimes(1);
    expect(h.ends).toHaveBeenCalledWith("down");
  });

  it("returns the body to the baseline when the drop is too short for a landing clip", async () => {
    // Top edge 1350: the whole 150 px drop is the hang, so no landing leg ever runs.
    const h = perchedHarness({
      position: { x: CORNER_X, y: 930 },
      windows: [win({ y: 1350, height: 150 })],
    });
    h.climber.start();
    await h.skipDwell();
    await h.runToEnd();

    expect(h.motions).toEqual([{ id: CLIMB_DOWN_MOTION_ID }, null]);
    expect(h.ends).toHaveBeenCalledWith("down");
    expect(h.drop).not.toHaveBeenCalled();
  });

  it("leaves a finishing oneshot alone at the end of a normal descent", async () => {
    const h = perchedHarness();
    h.climber.start();
    await h.skipDwell();
    await h.runToEnd();
    expect(h.motions.at(-1)).toEqual({ id: CLIMB_DOWN_LANDING_MOTION_ID });
  });

  it("reaches the landing clip's own displacement before it plays", async () => {
    const h = perchedHarness();
    h.climber.start();
    await h.skipDwell();
    await h.runToEnd();
    expect(h.preloads).toContain(CLIMB_DOWN_LANDING_MOTION_ID);
    expect(h.positions.some((p) => Math.abs(p.y - (1080 - LAND_PX)) < 1)).toBe(true);
  });

  it("never descends under reduced motion", async () => {
    const h = perchedHarness({ reducedMotion: true });
    h.climber.start();
    await h.skipDwell();
    await h.runFrames(10);
    expect(h.release).not.toHaveBeenCalled();
    expect(h.starts).not.toHaveBeenCalled();
  });

  it("rearms the dwell for the next sit after a descent", async () => {
    const h = perchedHarness();
    h.climber.start();
    await h.skipDwell();
    await h.runToEnd();
    await h.runFrames(2);
    h.release.mockClear();
    h.starts.mockClear();

    // Back on the ledge, this time from a drag drop: the dwell restarts from that sit.
    h.setPos(PERCHED_POS);
    h.setPerched(true);
    await h.frame();
    await h.frame(50);
    expect(h.release).not.toHaveBeenCalled();
    await h.frame(11);
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.starts).toHaveBeenCalledWith("down", TARGET);
  });
});
