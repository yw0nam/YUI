import { describe, expect, it, vi } from "vitest";
import type { ClimbConfig, WalkConfig } from "../config/load";
import type { MotionKind, WindowRect } from "../contract";
import type { ScreenMonitor } from "../io/screen-geometry";
import type { RenderMotionSignal, TickContext, TickFn } from "../renderer";
import {
  CLIMB_DOWN_LANDING_METRES,
  CLIMB_DOWN_LANDING_MOTION_ID,
  CLIMB_DOWN_MOTION_ID,
  CLIMB_UP_DONE_METRES,
  CLIMB_UP_DONE_MOTION_ID,
  CLIMB_UP_MOTION_ID,
  CLIMB_YAW_EASE_MS,
  CLIMB_YAW_RAD,
  type ClimbTarget,
  type ClimberDeps,
  climbSpeedPxPerSec,
  climbTargetLost,
  createClimber,
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
/** Where the up sequence leaves the window: feet on the target's top-left corner. */
const PERCHED_POS = { x: 800, y: 480 };

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

const TARGET: ClimbTarget = {
  windowNumber: 42,
  side: "left",
  edgeX: 1000,
  topY: 900,
  bottomY: 1500,
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
    expect(
      pickClimbTarget({ ...base, windows: [win({ y: 600, height: 380 })] }),
    ).toBeNull();
  });

  it("rejects a window shorter than half a character", () => {
    expect(pickClimbTarget({ ...base, windows: [win({ y: 1100, height: 200 })] })).toBeNull();
  });

  it("rejects a window taller than max_height_frac characters", () => {
    expect(pickClimbTarget({ ...base, windows: [win({ y: 600, height: 2100 })] })).toBeNull();
  });

  it("rejects a window with no standing room above its top edge", () => {
    expect(pickClimbTarget({ ...base, windows: [win({ y: 500, height: 1000 })] })).toBeNull();
  });

  it("rejects an edge whose wall column is covered by a window in front", () => {
    const front = win({ x: 900, y: 1200, width: 200, height: 300, windowNumber: 7 });
    expect(pickClimbTarget({ ...base, windows: [front, TARGET_WINDOW] })).toBeNull();
  });

  it("takes the far edge when only the near one's wall column is covered", () => {
    const front = win({ x: 900, y: 1200, width: 200, height: 300, windowNumber: 7 });
    const picked = pickClimbTarget({
      ...base,
      maxWalkPx: 800,
      windows: [front, TARGET_WINDOW],
    });
    expect(picked).toEqual({ ...TARGET, side: "right", edgeX: 1400 });
  });

  it("rejects an edge whose corner seat is covered by a window in front", () => {
    // Bottom edge exactly on the target's top edge: the column is clear, the seat is not.
    const front = win({ x: 1000, y: 800, width: 100, height: 100, windowNumber: 7 });
    expect(pickClimbTarget({ ...base, windows: [front, TARGET_WINDOW] })).toBeNull();
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
  const base = { windows: [TARGET_WINDOW], feetY: 900, tolerancePx: 24 };

  it("takes the nearer edge of the window under the feet", () => {
    expect(pickDescentTarget({ ...base, feetX: 1050 })).toEqual(TARGET);
    expect(pickDescentTarget({ ...base, feetX: 1350 })).toEqual({
      ...TARGET,
      side: "right",
      edgeX: 1400,
    });
  });

  it("returns null when no window top edge sits under the feet", () => {
    expect(pickDescentTarget({ ...base, feetX: 1050, feetY: 1200 })).toBeNull();
    expect(pickDescentTarget({ ...base, feetX: 200 })).toBeNull();
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
    const front = win({ x: 900, y: 1200, width: 200, height: 300, windowNumber: 7 });
    expect(climbTargetLost({ ...base, windows: [front, TARGET_WINDOW] })).toBe(true);
  });

  it("loses a target whose corner seat was newly covered", () => {
    const front = win({ x: 1000, y: 800, width: 100, height: 100, windowNumber: 7 });
    expect(climbTargetLost({ ...base, windows: [front, TARGET_WINDOW] })).toBe(true);
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
    /** What the injected walker reports for the approach walk. */
    walkResult?: "arrived" | "lost";
  } = {},
) {
  let tick: TickFn | null = null;
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
  const adoptSit = vi.fn();
  const drop = vi.fn();
  const walkerCancel = vi.fn();
  const release = vi.fn(() => {
    perched = false;
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
        currentMotion = m ? { id: m.id, vrma_path: `/motions/${m.id}.vrma` } : null;
      },
      getCurrentMotion: () => currentMotion,
      getMotionDuration: (id) => MOTION_S[id] ?? null,
      setBodyYaw: (rad, easeMs) => {
        yaws.push({ rad, easeMs });
      },
      getPxPerMetre: () => (over.pxPerMetre === undefined ? PX_PER_METRE : over.pxPerMetre),
      getCharacterAnchor: () => (over.anchor === undefined ? ANCHOR : over.anchor),
      getPerchProbe: () => {
        const charHpx = over.charHpx === undefined ? CHAR_HPX : over.charHpx;
        return charHpx === null ? null : { seatPx: { x: 200, y: 300 }, charHpx };
      },
      isPerched: () => perched,
    },
    getWindow: () => ({
      outerPosition: async () => ({ ...pos }),
      outerSize: async () => ({ width: 400, height: 600 }),
      scaleFactor: async () => 1,
      setPositionPhysical: async (x, y) => {
        pos = { x, y };
        positions.push({ x, y });
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
        walkTargets.push(toX);
        const outcome = over.walkResult ?? "arrived";
        if (outcome === "arrived") pos = { x: toX, y: pos.y };
        return outcome;
      },
      cancel: walkerCancel,
    },
    faller: { drop },
    dropSource: { adoptSit, release },
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
    starts,
    sits,
    ends,
    adoptSit,
    release,
    drop,
    walkerCancel,
    frame,
    skipInterval,
    skipDwell,
    runFrames,
    runToEnd,
    at: () => ({ ...pos }),
    setWindows: (next: WindowRect[]) => {
      windows = next;
    },
    setPerched: (next: boolean) => {
      perched = next;
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

  it("walks to the wall and reports the start when the interval fires", async () => {
    const h = makeHarness();
    h.climber.start();
    await h.skipInterval();
    expect(h.starts).toHaveBeenCalledWith("up", TARGET);
    expect(h.walkTargets).toEqual([800]);
    expect(h.yaws[0]).toEqual({ rad: CLIMB_YAW_RAD, easeMs: CLIMB_YAW_EASE_MS });
  });

  it("faces the other way for a right-hand wall", async () => {
    const h = makeHarness({ position: { x: 1300, y: 1080 } });
    h.climber.start();
    await h.skipInterval();
    expect(h.starts).toHaveBeenCalledWith("up", { ...TARGET, side: "right", edgeX: 1400 });
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
      expect(p.x).toBe(PERCHED_POS.x);
      expect(p.y).toBeGreaterThanOrEqual(PERCHED_POS.y);
      expect(p.y).toBeLessThanOrEqual(WINDOW_POS.y);
    }
    expect(h.yaws.at(-1)).toEqual({ rad: 0, easeMs: CLIMB_YAW_EASE_MS });
    expect(h.ends).toHaveBeenCalledWith("up");
    // Feet on the ledge: the top edge sits exactly the feet offset below the window origin.
    expect(h.sits).toHaveBeenCalledWith(TARGET, ANCHOR.y);
    expect(h.adoptSit).toHaveBeenCalledWith(42, { x: 1000, y: 900 }, CHAR_HPX);
  });

  it("hands the last stretch of the wall to the pull-over clip", async () => {
    const h = makeHarness();
    h.climber.start();
    await h.skipInterval();
    await h.runToEnd();
    // The pull-over covers its own 1.38 m; the loop covers the rest of the 600 px rise.
    const pullPx = PX_PER_METRE * CLIMB_UP_DONE_METRES;
    expect(pullPx).toBeCloseTo(414, 6);
    expect(h.positions.some((p) => Math.abs(p.y - (PERCHED_POS.y + pullPx)) < 1)).toBe(true);
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
    h.setWindows([win({ x: 900, y: 1200, width: 200, height: 300, windowNumber: 7 }), TARGET_WINDOW]);
    await h.runFrames(10);
    expect(h.drop).toHaveBeenCalledTimes(1);
  });

  it("ends the climb when the document is hidden", async () => {
    const h = makeHarness();
    h.climber.start();
    await h.skipInterval();
    await h.runFrames(3);
    h.hide();
    expect(h.ends).toHaveBeenCalledWith("up");
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
    expect(h.walkTargets).toEqual([800]);
    expect(h.yaws[0]).toEqual({ rad: CLIMB_YAW_RAD, easeMs: CLIMB_YAW_EASE_MS });
  });

  it("hangs off the edge, descends the wall and lands on the floor", async () => {
    const h = perchedHarness();
    h.climber.start();
    await h.skipDwell();
    await h.runToEnd();

    expect(h.motions).toEqual([
      { id: CLIMB_DOWN_MOTION_ID },
      { id: CLIMB_DOWN_LANDING_MOTION_ID },
    ]);
    expect(h.at()).toEqual({ x: 800, y: 1080 });
    for (const p of h.positions) {
      expect(p.x).toBe(800);
      expect(p.y).toBeGreaterThanOrEqual(PERCHED_POS.y);
      expect(p.y).toBeLessThanOrEqual(1080);
    }
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

  it("hands over to the faller when the window bottom hangs above the floor", async () => {
    const short = win({ height: 400 });
    const h = perchedHarness({ windows: [short] });
    h.climber.start();
    await h.skipDwell();
    await h.runToEnd();

    expect(h.motions).toEqual([{ id: CLIMB_DOWN_MOTION_ID }]);
    // Feet stop at the window bottom (1300); the faller covers the rest.
    expect(h.at()).toEqual({ x: 800, y: 880 });
    expect(h.drop).toHaveBeenCalledTimes(1);
    expect(h.ends).toHaveBeenCalledWith("down");
  });

  it("reaches the landing clip's own displacement before it plays", async () => {
    const h = perchedHarness();
    h.climber.start();
    await h.skipDwell();
    await h.runToEnd();
    const landPx = PX_PER_METRE * CLIMB_DOWN_LANDING_METRES;
    expect(landPx).toBeCloseTo(75, 6);
    expect(h.positions.some((p) => Math.abs(p.y - (1080 - landPx)) < 1)).toBe(true);
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
    h.ends.mockClear();
    h.release.mockClear();
    h.setPerched(true);
    await h.frame();
    await h.frame(50);
    expect(h.release).not.toHaveBeenCalled();
    await h.frame(11);
    expect(h.release).toHaveBeenCalledTimes(1);
  });
});
