import { afterEach, describe, expect, it, vi } from "vitest";
import type { WalkConfig } from "../config/load";
import type { RenderMotionSignal, TickContext, TickFn } from "../renderer";
import {
  advanceX,
  canStartStroll,
  createWalker,
  nextWalkDelay,
  onFloor,
  planStroll,
  WALK_MOTION_ID,
  WALK_YAW_EASE_MS,
  WALK_YAW_RAD,
  type WalkerDeps,
  type WalkerMonitor,
  walkSpeedPxPerSec,
} from "./walker";

const CFG: WalkConfig = {
  interval_min_ms: 60_000,
  interval_max_ms: 180_000,
  distance_min_px: 80,
  distance_max_px: 320,
  floor_tolerance_px: 8,
};

/** rng that yields the given values in order, then repeats the last one. */
function seqRng(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)] ?? 0;
}

describe("nextWalkDelay", () => {
  it("draws inside the configured interval range", () => {
    expect(nextWalkDelay(CFG, () => 0)).toBe(60_000);
    expect(nextWalkDelay(CFG, () => 0.5)).toBe(120_000);
    expect(nextWalkDelay(CFG, () => 1)).toBe(180_000);
  });

  it("honours a narrowed configured range", () => {
    const cfg = { ...CFG, interval_min_ms: 1000, interval_max_ms: 2000 };
    expect(nextWalkDelay(cfg, () => 0.25)).toBe(1250);
  });
});

describe("walkSpeedPxPerSec", () => {
  it("divides the clip's 1.34 m stride by the cycle length the clip actually loops on", () => {
    expect(walkSpeedPxPerSec(100, 1.267)).toBeCloseTo((100 * 1.34) / 1.267, 6);
  });

  it("slows down as the cycle lengthens", () => {
    expect(walkSpeedPxPerSec(100, 2.534)).toBeCloseTo(walkSpeedPxPerSec(100, 1.267) / 2, 6);
  });

  it("scales linearly with the framing so the feet never slide", () => {
    expect(walkSpeedPxPerSec(600, 1.267)).toBeCloseTo(walkSpeedPxPerSec(300, 1.267) * 2, 6);
  });
});

describe("onFloor", () => {
  it("accepts a window bottom within tolerance of the work-area bottom", () => {
    expect(onFloor(1000, 1000, 8)).toBe(true);
    expect(onFloor(1006, 1000, 8)).toBe(true);
    expect(onFloor(994, 1000, 8)).toBe(true);
  });

  it("rejects a window bottom outside tolerance on either side", () => {
    expect(onFloor(1009, 1000, 8)).toBe(false);
    expect(onFloor(600, 1000, 8)).toBe(false);
  });
});

describe("canStartStroll", () => {
  const ok = {
    onFloor: true,
    perched: false,
    peeking: false,
    dragging: false,
    ambientMotion: true,
    busy: false,
    reducedMotion: false,
  };

  it("passes when the character is idle on the floor", () => {
    expect(canStartStroll(ok)).toBe(true);
  });

  it.each([
    ["off the floor", { onFloor: false }],
    ["perched", { perched: true }],
    ["peeking", { peeking: true }],
    ["dragging", { dragging: true }],
    ["a speech/thinking/reactive motion active", { ambientMotion: false }],
    ["the pipeline busy (a turn in flight or speech playing)", { busy: true }],
    ["reduced motion", { reducedMotion: true }],
  ])("blocks on %s", (_label, blocker) => {
    expect(canStartStroll({ ...ok, ...blocker })).toBe(false);
  });
});

describe("planStroll", () => {
  const base = { width: 200, workX: 0, workWidth: 1920, cfg: CFG };

  it("walks the drawn distance to the right", () => {
    expect(planStroll({ ...base, x: 500, rng: seqRng(0, 0.9) })).toEqual({
      toX: 580,
      direction: 1,
    });
  });

  it("walks the drawn distance to the left", () => {
    expect(planStroll({ ...base, x: 500, rng: seqRng(1, 0.1) })).toEqual({
      toX: 180,
      direction: -1,
    });
  });

  it("clamps the destination to the right edge of the work area", () => {
    expect(planStroll({ ...base, x: 1650, rng: seqRng(1, 0.9) })?.toX).toBe(1720);
  });

  it("clamps the destination to the left edge of the work area", () => {
    expect(planStroll({ ...base, x: 50, rng: seqRng(1, 0.1) })?.toX).toBe(0);
  });

  it("clamps against a work area that does not start at the origin", () => {
    expect(
      planStroll({ ...base, x: 2000, workX: 1920, workWidth: 1280, rng: seqRng(1, 0.1) })?.toX,
    ).toBe(1920);
  });

  it("returns null when the drawn direction has no room left", () => {
    expect(planStroll({ ...base, x: 1720, rng: seqRng(1, 0.9) })).toBeNull();
  });

  it("returns null when the window is wider than the work area", () => {
    expect(planStroll({ ...base, x: 0, width: 2000, rng: seqRng(0, 0.9) })).toBeNull();
  });
});

describe("advanceX", () => {
  it("advances by speed × dt toward the destination", () => {
    expect(advanceX(0, 100, 50, 1)).toBe(50);
    expect(advanceX(100, 0, 50, 1)).toBe(50);
  });

  it("never overshoots the destination", () => {
    expect(advanceX(0, 100, 50, 3)).toBe(100);
    expect(advanceX(100, 0, 50, 10)).toBe(0);
  });
});

// ── runtime loop ──────────────────────────────────────────────────────────────

const MONITOR: WalkerMonitor = {
  position: { x: 0, y: 0 },
  size: { width: 1920, height: 1600 },
  workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1500 } },
};

/** The shipped walk.vrma loops on its own last keyframe, not on a nominal 1.37 s cycle. */
const CLIP_S = 1.267;
/** Feet sit this far below the canvas top — the framing margin leaves the rest as headroom. */
const FEET_Y = 420;
/** Window sized 400×600 whose FEET (y + FEET_Y = 1500) rest on the floor; its bottom hangs below. */
const WINDOW_POS = { x: 500, y: 1080 };

/**
 * rng () => 0 ⇒ a 60 s interval and an 80 px stroll to the left (destination 420).
 */
function makeHarness(
  over: {
    position?: { x: number; y: number };
    /** Canvas-local logical y of the feet anchor. null models an unloaded VRM. */
    feetY?: number | null;
    pxPerMetre?: number | null;
    perched?: boolean;
    peeking?: boolean;
    dragging?: boolean;
    busy?: boolean;
    /** Duration (s) the walk clip loops on. null models a clip still loading. */
    clipDuration?: number | null;
    /** Models playMotion silently dropping the walk request (perch suppression, dead clip). */
    motionRefused?: boolean;
    motionKind?: WalkerDeps["currentMotionKind"];
    rng?: () => number;
  } = {},
) {
  let tick: TickFn | null = null;
  const motions: Array<RenderMotionSignal | null> = [];
  const yaws: Array<{ rad: number; easeMs: number }> = [];
  const positions: Array<{ x: number; y: number }> = [];
  let currentMotion: { id: string; vrma_path: string } | null = {
    id: "idle",
    vrma_path: "/motions/calm.vrma",
  };
  const starts = vi.fn();
  const ends = vi.fn();
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

  const deps: WalkerDeps = {
    renderer: {
      onTick: (fn) => {
        tick = fn;
        return () => {
          tick = null;
        };
      },
      playMotion: (m) => {
        motions.push(m);
        if (over.motionRefused) return;
        currentMotion = m ? { id: m.id, vrma_path: `/motions/${m.id}.vrma` } : null;
      },
      getCurrentMotion: () => currentMotion,
      getMotionDuration: () => (over.clipDuration === undefined ? CLIP_S : over.clipDuration),
      setBodyYaw: (rad, easeMs) => {
        yaws.push({ rad, easeMs });
      },
      getPxPerMetre: () => (over.pxPerMetre === undefined ? 300 : over.pxPerMetre),
      getCharacterAnchor: () => {
        const y = over.feetY === undefined ? FEET_Y : over.feetY;
        return y === null ? null : { x: 200, y };
      },
      isPerched: () => over.perched ?? false,
    },
    getWindow: () => ({
      outerPosition: async () => over.position ?? WINDOW_POS,
      outerSize: async () => ({ width: 400, height: 600 }),
      scaleFactor: async () => 1,
      setPositionPhysical: async (x, y) => {
        positions.push({ x, y });
      },
    }),
    listMonitors: async () => [MONITOR],
    getConfig: () => CFG,
    currentMotionKind: over.motionKind ?? (() => "ambient"),
    isPeeking: () => over.peeking ?? false,
    isDragging: () => over.dragging ?? false,
    isBusy: () => over.busy ?? false,
    doc,
    onStart: starts,
    onEnd: ends,
    rng: over.rng ?? (() => 0),
  };

  const walker = createWalker(deps);
  let elapsed = 0;
  const frame = async (dt = 1 / 60): Promise<void> => {
    elapsed += dt;
    tick?.({ vrm: {} as never, dt, elapsed } as TickContext);
    // Let the async window/monitor reads settle before the next frame.
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };
  /** One frame with no microtask flush — leaves the fire-time reads in flight. */
  const tickOnly = (dt: number): void => {
    elapsed += dt;
    tick?.({ vrm: {} as never, dt, elapsed } as TickContext);
  };
  /** One frame to arm the interval, then one that lands past it. */
  const skipInterval = async (): Promise<void> => {
    await frame();
    await frame(200);
  };

  return {
    walker,
    motions,
    yaws,
    positions,
    starts,
    ends,
    frame,
    tickOnly,
    skipInterval,
    setCurrentMotion: (m: { id: string; vrma_path: string } | null) => {
      currentMotion = m;
    },
    hide: () => {
      doc.visibilityState = "hidden";
      for (const cb of visibilityListeners) cb();
    },
    visibilityListenerCount: () => visibilityListeners.size,
    hasTick: () => tick !== null,
  };
}

describe("createWalker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers a tick hook on start and unregisters it on stop", () => {
    const h = makeHarness();
    expect(h.hasTick()).toBe(false);
    h.walker.start();
    expect(h.hasTick()).toBe(true);
    h.walker.stop();
    expect(h.hasTick()).toBe(false);
  });

  it("holds still until the armed interval elapses", async () => {
    const h = makeHarness();
    h.walker.start();
    await h.frame();
    await h.frame(59);
    expect(h.motions).toEqual([]);
    expect(h.starts).not.toHaveBeenCalled();
  });

  it("plays the walk clip and yaws toward the travel direction when the interval fires", async () => {
    const h = makeHarness();
    h.walker.start();
    await h.skipInterval();
    expect(h.motions).toEqual([{ id: WALK_MOTION_ID }]);
    expect(h.yaws).toEqual([{ rad: -WALK_YAW_RAD, easeMs: WALK_YAW_EASE_MS }]);
    expect(h.starts).toHaveBeenCalledTimes(1);
    expect(h.walker.isWalking()).toBe(true);
  });

  it("yaws the opposite way for a rightward stroll", async () => {
    const h = makeHarness({ rng: () => 0.9 });
    h.walker.start();
    await h.skipInterval();
    expect(h.yaws).toEqual([{ rad: WALK_YAW_RAD, easeMs: WALK_YAW_EASE_MS }]);
  });

  it("translates the window to the destination without overshoot, then returns to idle", async () => {
    const h = makeHarness();
    h.walker.start();
    await h.skipInterval();
    // 80 logical px at ~293 px/s ≈ 0.27 s.
    for (let i = 0; i < 30; i++) await h.frame();
    expect(h.positions.at(-1)).toEqual({ x: 420, y: WINDOW_POS.y });
    for (const p of h.positions) {
      expect(p.x).toBeGreaterThanOrEqual(420);
      expect(p.x).toBeLessThanOrEqual(500);
      expect(p.y).toBe(WINDOW_POS.y);
    }
    expect(h.positions.length).toBeGreaterThan(5);
    expect(h.motions).toEqual([{ id: WALK_MOTION_ID }, null]);
    expect(h.yaws.at(-1)).toEqual({ rad: 0, easeMs: WALK_YAW_EASE_MS });
    expect(h.ends).toHaveBeenCalledTimes(1);
    expect(h.walker.isWalking()).toBe(false);
  });

  it("skips and redraws when the feet are not resting on the work-area floor", async () => {
    const h = makeHarness({ position: { x: 500, y: 400 } });
    h.walker.start();
    await h.skipInterval();
    expect(h.motions).toEqual([]);
    expect(h.starts).not.toHaveBeenCalled();
  });

  it("skips when the window bottom rests on the floor but the feet float above it", async () => {
    // Window bottom 900 + 600 = 1500 == the floor, yet the feet project 180px higher.
    const h = makeHarness({ position: { x: 500, y: 900 } });
    h.walker.start();
    await h.skipInterval();
    expect(h.motions).toEqual([]);
    expect(h.starts).not.toHaveBeenCalled();
  });

  it("starts when the feet rest on the floor even though the window bottom hangs below it", async () => {
    // Feet 1080 + 420 = 1500 == the floor; the window bottom is 180px past the work area.
    const h = makeHarness();
    h.walker.start();
    await h.skipInterval();
    expect(h.starts).toHaveBeenCalledTimes(1);
    expect(h.motions).toEqual([{ id: WALK_MOTION_ID }]);
  });

  it("skips when the feet anchor is unavailable", async () => {
    const h = makeHarness({ feetY: null });
    h.walker.start();
    await h.skipInterval();
    expect(h.starts).not.toHaveBeenCalled();
  });

  it.each([
    ["perched", { perched: true }],
    ["peeking", { peeking: true }],
    ["dragging", { dragging: true }],
    ["a reactive motion holds the body", { motionKind: () => "reactive" as const }],
    ["a turn is in flight or speech is playing", { busy: true }],
  ])("skips while %s", async (_label, over) => {
    const h = makeHarness(over);
    h.walker.start();
    await h.skipInterval();
    expect(h.motions).toEqual([]);
    expect(h.starts).not.toHaveBeenCalled();
  });

  it("skips when the framing cannot be measured", async () => {
    const h = makeHarness({ pxPerMetre: null });
    h.walker.start();
    await h.skipInterval();
    expect(h.starts).not.toHaveBeenCalled();
  });

  it("stops translating when a higher-priority motion takes the walk clip", async () => {
    const h = makeHarness();
    h.walker.start();
    await h.skipInterval();
    await h.frame();
    const movedSoFar = h.positions.length;
    h.setCurrentMotion({ id: "happy", vrma_path: "/motions/happy.vrma" });
    await h.frame();
    await h.frame();
    expect(h.positions.length).toBe(movedSoFar);
    // The incoming motion owns the body — the walker must not force it back to idle.
    expect(h.motions).toEqual([{ id: WALK_MOTION_ID }]);
    expect(h.yaws.at(-1)).toEqual({ rad: 0, easeMs: WALK_YAW_EASE_MS });
    expect(h.ends).toHaveBeenCalledTimes(1);
    expect(h.walker.isWalking()).toBe(false);
  });

  it("cancel() aborts a running stroll, returns the yaw, and reports the end once", async () => {
    const h = makeHarness();
    h.walker.start();
    await h.skipInterval();
    await h.frame();
    const movedSoFar = h.positions.length;
    h.walker.cancel();
    expect(h.walker.isWalking()).toBe(false);
    expect(h.motions).toEqual([{ id: WALK_MOTION_ID }, null]);
    expect(h.yaws.at(-1)).toEqual({ rad: 0, easeMs: WALK_YAW_EASE_MS });
    expect(h.ends).toHaveBeenCalledTimes(1);
    await h.frame();
    expect(h.positions.length).toBe(movedSoFar);
    h.walker.cancel();
    expect(h.ends).toHaveBeenCalledTimes(1);
  });

  it("drops a stroll whose plan was still in flight when a cancel landed", async () => {
    const h = makeHarness();
    h.walker.start();
    await h.frame();
    h.tickOnly(200);
    h.walker.cancel();
    await h.frame();
    expect(h.starts).not.toHaveBeenCalled();
    expect(h.walker.isWalking()).toBe(false);
    expect(h.motions).toEqual([]);
  });

  it("ends a running stroll when the document goes hidden", async () => {
    const h = makeHarness();
    h.walker.start();
    await h.skipInterval();
    await h.frame();
    const movedSoFar = h.positions.length;

    h.hide();
    expect(h.ends).toHaveBeenCalledTimes(1);
    expect(h.motions).toEqual([{ id: WALK_MOTION_ID }, null]);

    await h.frame();
    expect(h.positions.length).toBe(movedSoFar);
  });

  it("drops the visibility listener on stop", () => {
    const h = makeHarness();
    h.walker.start();
    expect(h.visibilityListenerCount()).toBe(1);
    h.walker.stop();
    expect(h.visibilityListenerCount()).toBe(0);
  });

  it("does not report a start when the walk request is refused", async () => {
    const h = makeHarness({ motionRefused: true });
    h.walker.start();
    await h.skipInterval();
    expect(h.motions).toEqual([{ id: WALK_MOTION_ID }]);
    expect(h.starts).not.toHaveBeenCalled();
    expect(h.ends).not.toHaveBeenCalled();
    expect(h.yaws).toEqual([]);

    await h.frame();
    expect(h.positions).toEqual([]);
  });

  it("clamps a long frame delta so a throttled gap does not hop to the destination", async () => {
    const h = makeHarness();
    h.walker.start();
    await h.skipInterval();

    // 5 s of accumulated clock would cover the whole 80 px stroll many times over.
    await h.frame(5);
    const x = h.positions.at(-1)!.x;
    expect(x).toBeGreaterThan(420);
    expect(x).toBeLessThan(500);
    expect(h.ends).not.toHaveBeenCalled();
  });

  it("paces the window at the loaded clip's own cycle, not a nominal one", async () => {
    const h = makeHarness();
    h.walker.start();
    await h.skipInterval();

    // A full clamped frame — a 1/60 s step is too small to separate 1.267 s from 1.37 s.
    const dt = 0.1;
    await h.frame(dt);
    // 300 px/m over a 1.267 s cycle carrying 1.34 m of stride.
    const expected = WINDOW_POS.x - ((300 * 1.34) / CLIP_S) * dt;
    expect(h.positions.at(-1)!.x).toBe(Math.round(expected));
  });

  it("holds position while the walk clip is still loading", async () => {
    const h = makeHarness({ clipDuration: null });
    h.walker.start();
    await h.skipInterval();
    expect(h.starts).toHaveBeenCalledTimes(1);

    await h.frame();
    await h.frame();
    expect(h.positions).toEqual([]);
    expect(h.ends).not.toHaveBeenCalled();
  });

  it("cancel() outside a stroll reports nothing", () => {
    const h = makeHarness();
    h.walker.start();
    h.walker.cancel();
    expect(h.ends).not.toHaveBeenCalled();
  });

  it("stop() ends a running stroll", async () => {
    const h = makeHarness();
    h.walker.start();
    await h.skipInterval();
    h.walker.stop();
    expect(h.ends).toHaveBeenCalledTimes(1);
    expect(h.walker.isWalking()).toBe(false);
  });

  it("never starts a stroll while prefers-reduced-motion is set", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const h = makeHarness();
    h.walker.start();
    await h.skipInterval();
    expect(h.starts).not.toHaveBeenCalled();
  });

  it("cancels a running stroll when reduced motion turns on", async () => {
    const listeners: Array<(e: { matches: boolean }) => void> = [];
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => {
        listeners.push(cb);
      },
      removeEventListener: () => {},
    }));
    const h = makeHarness();
    h.walker.start();
    await h.skipInterval();
    expect(h.walker.isWalking()).toBe(true);
    for (const cb of listeners) cb({ matches: true });
    expect(h.walker.isWalking()).toBe(false);
    expect(h.ends).toHaveBeenCalledTimes(1);
  });

  it("redraws the interval after a stroll instead of chaining another one", async () => {
    const h = makeHarness();
    h.walker.start();
    await h.skipInterval();
    for (let i = 0; i < 30; i++) await h.frame();
    expect(h.starts).toHaveBeenCalledTimes(1);
    await h.frame(59);
    expect(h.starts).toHaveBeenCalledTimes(1);
  });
});
