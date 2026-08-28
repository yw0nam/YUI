import { describe, expect, it, vi } from "vitest";
import type { FallConfig } from "../config/load";
import type { MotionKind } from "../contract";
import type { ScreenMonitor } from "../io/screen-geometry";
import type { RenderMotionSignal, TickContext, TickFn } from "../renderer";
import {
  createFaller,
  FALL_MOTION_ID,
  type FallerDeps,
  LAND_MOTION_ID,
  planFall,
  stepFall,
} from "./faller";

const CFG: FallConfig = {
  gravity_px_s2: 2400,
  max_speed_px_s: 1800,
  min_drop_frac: 0.2,
  cue_cooldown_ms: 60_000,
};

/** Floor tolerance shared with the walker's grounded test. */
const TOLERANCE = 24;

describe("planFall", () => {
  const base = { windowY: 600, floorY: 1500, charHpx: 500, cfg: CFG, tolerancePx: TOLERANCE };

  it("falls the whole gap between the feet and the floor", () => {
    expect(planFall({ ...base, feetY: 1200 })).toEqual({
      kind: "fall",
      toY: 900,
      heightPx: 300,
    });
  });

  it("snaps a drop shorter than min_drop_frac of the character height", () => {
    // 500 × 0.2 = 100 px threshold; 60 px is past the tolerance but under it.
    expect(planFall({ ...base, feetY: 1440 })).toEqual({ kind: "snap", toY: 660 });
  });

  it("falls a drop that reaches the threshold exactly", () => {
    expect(planFall({ ...base, feetY: 1400 })).toEqual({
      kind: "fall",
      toY: 700,
      heightPx: 100,
    });
  });

  it("measures the threshold against the character's on-screen height", () => {
    // A smaller character makes the same 60 px drop worth falling.
    expect(planFall({ ...base, feetY: 1440, charHpx: 100 })).toEqual({
      kind: "fall",
      toY: 660,
      heightPx: 60,
    });
  });

  it("does nothing when the feet already rest within the floor tolerance", () => {
    expect(planFall({ ...base, feetY: 1490 })).toEqual({ kind: "none" });
    expect(planFall({ ...base, feetY: 1476 })).toEqual({ kind: "none" });
  });

  it("does nothing when the feet hang below the floor", () => {
    expect(planFall({ ...base, feetY: 1600 })).toEqual({ kind: "none" });
  });
});

describe("stepFall", () => {
  it("accelerates downward by gravity × dt", () => {
    expect(stepFall({ y: 0, v: 0, toY: 1000 }, 0.1, CFG)).toEqual({ y: 24, v: 240, landed: false });
  });

  it("never exceeds the terminal velocity", () => {
    expect(stepFall({ y: 0, v: 1750, toY: 100_000 }, 0.1, CFG).v).toBe(1800);
  });

  it("clamps at the destination and reports the touchdown", () => {
    expect(stepFall({ y: 990, v: 1800, toY: 1000 }, 0.1, CFG)).toEqual({
      y: 1000,
      v: 1800,
      landed: true,
    });
  });
});

// ── runtime loop ──────────────────────────────────────────────────────────────

const MONITOR: ScreenMonitor = {
  position: { x: 0, y: 0 },
  size: { width: 1920, height: 1600 },
  workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1500 } },
};

/** Feet sit this far below the canvas top — the framing margin leaves the rest as headroom. */
const FEET_Y = 420;
/** Current on-screen character height; the 0.2 fraction makes the snap threshold 100 px. */
const CHAR_HPX = 500;
/** Window whose feet (300 + 420 = 720) float 780 px above the floor line. */
const WINDOW_POS = { x: 500, y: 300 };
/** Window y that puts the feet on the floor. */
const GROUNDED_Y = 1080;

/** Registry kinds of the clips these tests hand the body to. */
const MOTION_KINDS: Record<string, MotionKind> = {
  idle: "ambient",
  falling: "reactive",
  landing: "oneshot",
  drag: "reactive",
  happy: "oneshot",
};

function makeHarness(
  over: {
    position?: { x: number; y: number };
    /** Canvas-local logical y of the feet anchor. null models an unloaded VRM. */
    feetY?: number | null;
    /** null models a probe the renderer cannot take (no VRM / projection failed). */
    charHpx?: number | null;
    scale?: number;
    reducedMotion?: boolean;
    /** Models playMotion silently dropping the falling request (dead clip). */
    motionRefused?: boolean;
  } = {},
) {
  let tick: TickFn | null = null;
  const motions: Array<RenderMotionSignal | null> = [];
  const positions: Array<{ x: number; y: number }> = [];
  let currentMotion: { id: string; vrma_path: string } | null = {
    id: "idle",
    vrma_path: "/motions/calm.vrma",
  };
  let clock = 1_000_000;
  const starts = vi.fn();
  const lands = vi.fn();
  const cues = vi.fn();
  const ends = vi.fn();

  const deps: FallerDeps = {
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
      getCharacterAnchor: () => {
        const y = over.feetY === undefined ? FEET_Y : over.feetY;
        return y === null ? null : { x: 200, y };
      },
      getPerchProbe: () => {
        const charHpx = over.charHpx === undefined ? CHAR_HPX : over.charHpx;
        return charHpx === null ? null : { seatPx: { x: 200, y: 300 }, charHpx };
      },
    },
    getWindow: () => ({
      outerPosition: async () => over.position ?? WINDOW_POS,
      outerSize: async () => ({ width: 400, height: 600 }),
      scaleFactor: async () => over.scale ?? 1,
      setPositionPhysical: async (x, y) => {
        positions.push({ x, y });
      },
    }),
    currentMotionKind: () => (currentMotion ? MOTION_KINDS[currentMotion.id] : null),
    listMonitors: async () => [MONITOR],
    getConfig: () => CFG,
    getFloorTolerancePx: () => TOLERANCE,
    reducedMotion: () => over.reducedMotion ?? false,
    now: () => clock,
    onStart: starts,
    onLand: lands,
    onCue: cues,
    onEnd: ends,
  };

  const faller = createFaller(deps);
  let elapsed = 0;
  const frame = async (dt = 1 / 60): Promise<void> => {
    elapsed += dt;
    tick?.({ vrm: {} as never, dt, elapsed } as TickContext);
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };
  /** Fall until the touchdown, or give up after a second of frames. */
  const fallToFloor = async (): Promise<void> => {
    for (let i = 0; i < 120 && positions.at(-1)?.y !== GROUNDED_Y; i++) await frame();
  };

  return {
    faller,
    motions,
    positions,
    starts,
    lands,
    cues,
    ends,
    frame,
    fallToFloor,
    advanceClock: (ms: number) => {
      clock += ms;
    },
    setCurrentMotion: (m: { id: string; vrma_path: string } | null) => {
      currentMotion = m;
    },
    hasTick: () => tick !== null,
  };
}

describe("createFaller", () => {
  it("plays the falling clip and reports the start when the drop lands mid-air", async () => {
    const h = makeHarness();
    await h.faller.drop();
    expect(h.motions).toEqual([{ id: FALL_MOTION_ID }]);
    expect(h.starts).toHaveBeenCalledTimes(1);
    expect(h.hasTick()).toBe(true);
  });

  it("accelerates down to the floor, then plays landing and reports the height", async () => {
    const h = makeHarness();
    await h.faller.drop();
    await h.fallToFloor();

    expect(h.positions.at(-1)).toEqual({ x: WINDOW_POS.x, y: GROUNDED_Y });
    expect(h.positions.length).toBeGreaterThan(5);
    for (const p of h.positions) {
      expect(p.x).toBe(WINDOW_POS.x);
      expect(p.y).toBeGreaterThan(WINDOW_POS.y);
      expect(p.y).toBeLessThanOrEqual(GROUNDED_Y);
    }
    // Gravity, not a constant speed: later frames cover more ground than early ones.
    const first = h.positions[1].y - h.positions[0].y;
    const last = h.positions.at(-2)!.y - h.positions.at(-3)!.y;
    expect(last).toBeGreaterThan(first);

    expect(h.motions).toEqual([{ id: FALL_MOTION_ID }, { id: LAND_MOTION_ID }]);
    expect(h.lands).toHaveBeenCalledWith(780);
    expect(h.ends).toHaveBeenCalledTimes(1);
    expect(h.hasTick()).toBe(false);
  });

  it("clamps a long frame delta so a throttled gap does not teleport to the floor", async () => {
    const h = makeHarness();
    await h.faller.drop();
    await h.frame(5);
    expect(h.positions.at(-1)!.y).toBeLessThan(GROUNDED_Y);
    expect(h.lands).not.toHaveBeenCalled();
  });

  it("snaps the feet to the floor without a clip for a drop under the min fraction", async () => {
    // Feet 60 px above the floor: past the tolerance, under the 100 px threshold.
    const h = makeHarness({ position: { x: 500, y: 1020 } });
    await h.faller.drop();
    expect(h.positions).toEqual([{ x: 500, y: GROUNDED_Y }]);
    expect(h.motions).toEqual([]);
    expect(h.starts).not.toHaveBeenCalled();
    expect(h.lands).not.toHaveBeenCalled();
    expect(h.cues).not.toHaveBeenCalled();
  });

  it("falls the same short drop when the character is small on screen", async () => {
    const h = makeHarness({ position: { x: 500, y: 1020 }, charHpx: 100 });
    await h.faller.drop();
    expect(h.motions).toEqual([{ id: FALL_MOTION_ID }]);
    await h.fallToFloor();
    expect(h.lands).toHaveBeenCalledWith(60);
  });

  it("does nothing when the feet already rest on the floor", async () => {
    const h = makeHarness({ position: { x: 500, y: GROUNDED_Y - 10 } });
    await h.faller.drop();
    expect(h.positions).toEqual([]);
    expect(h.motions).toEqual([]);
    expect(h.ends).not.toHaveBeenCalled();
  });

  it("falls in physical px through the scale factor on a scaled screen", async () => {
    // Scale 2 ⇒ floor 750 and feet 450 in logical px: a 300 px drop, 600 px of window travel.
    const h = makeHarness({ position: { x: 500, y: 60 }, scale: 2 });
    await h.faller.drop();
    expect(h.motions).toEqual([{ id: FALL_MOTION_ID }]);

    // Gravity scales with the screen too: v = 4800 × 0.05 = 240 px/s ⇒ 12 px this frame.
    await h.frame(0.05);
    expect(h.positions.at(-1)).toEqual({ x: 500, y: 72 });

    for (let i = 0; i < 120 && h.positions.at(-1)?.y !== 660; i++) await h.frame();
    expect(h.positions.at(-1)).toEqual({ x: 500, y: 660 });
    expect(h.lands).toHaveBeenCalledWith(300);
  });

  it("snaps to the floor and still reports the landing under reduced motion", async () => {
    const h = makeHarness({ reducedMotion: true });
    await h.faller.drop();
    expect(h.positions).toEqual([{ x: WINDOW_POS.x, y: GROUNDED_Y }]);
    expect(h.motions).toEqual([]);
    expect(h.lands).toHaveBeenCalledWith(780);
    expect(h.cues).toHaveBeenCalledWith(780);
    expect(h.starts).not.toHaveBeenCalled();
  });

  it("holds the cue back inside the cooldown window and lets it through after", async () => {
    const h = makeHarness({ reducedMotion: true });
    await h.faller.drop();
    h.advanceClock(30_000);
    await h.faller.drop();
    expect(h.lands).toHaveBeenCalledTimes(2);
    expect(h.cues).toHaveBeenCalledTimes(1);

    h.advanceClock(30_000);
    await h.faller.drop();
    expect(h.cues).toHaveBeenCalledTimes(2);
  });

  it("keeps descending while the pickup clip holds the body — the drag start ends it", async () => {
    const h = makeHarness();
    await h.faller.drop();
    await h.frame();
    const movedSoFar = h.positions.length;

    h.setCurrentMotion({ id: "drag", vrma_path: "/motions/drag.vrma" });
    await h.frame();
    // The pickup owns the body — the faller must not take the clip back from it.
    expect(h.motions).toEqual([{ id: FALL_MOTION_ID }]);
    expect(h.positions.length).toBeGreaterThan(movedSoFar);
    expect(h.ends).not.toHaveBeenCalled();

    // user.drag_start is what takes her out of the fall.
    h.faller.cancel();
    expect(h.ends).toHaveBeenCalledTimes(1);
    expect(h.motions).toEqual([{ id: FALL_MOTION_ID }]);
    const moved = h.positions.length;
    await h.frame();
    expect(h.positions.length).toBe(moved);
    expect(h.lands).not.toHaveBeenCalled();
  });

  it("leaves an express clip that arrives mid-descent alone and keeps falling", async () => {
    const h = makeHarness();
    await h.faller.drop();
    await h.frame();
    const movedSoFar = h.positions.length;

    // A backend turn's oneshot: lower priority, but the faller does not fight it.
    h.setCurrentMotion({ id: "happy", vrma_path: "/motions/happy.vrma" });
    await h.frame();
    await h.frame();

    expect(h.motions).toEqual([{ id: FALL_MOTION_ID }]);
    expect(h.positions.length).toBeGreaterThan(movedSoFar);
    expect(h.ends).not.toHaveBeenCalled();
  });

  it("keeps falling when the drag-release envelopes return the body to the baseline", async () => {
    const h = makeHarness();
    await h.faller.drop();
    await h.frame();
    const movedSoFar = h.positions.length;

    // The ambient baseline is the one clip the descent takes back.
    h.setCurrentMotion({ id: "idle", vrma_path: "/motions/calm.vrma" });
    await h.frame();

    expect(h.motions).toEqual([{ id: FALL_MOTION_ID }, { id: FALL_MOTION_ID }]);
    expect(h.positions.length).toBeGreaterThan(movedSoFar);
    expect(h.ends).not.toHaveBeenCalled();

    await h.fallToFloor();
    expect(h.lands).toHaveBeenCalledWith(780);
  });

  it("cancel() ends a running fall and releases the falling clip", async () => {
    const h = makeHarness();
    await h.faller.drop();
    await h.frame();
    const movedSoFar = h.positions.length;

    h.faller.cancel();
    expect(h.motions).toEqual([{ id: FALL_MOTION_ID }, null]);
    expect(h.ends).toHaveBeenCalledTimes(1);

    await h.frame();
    expect(h.positions.length).toBe(movedSoFar);
    h.faller.cancel();
    expect(h.ends).toHaveBeenCalledTimes(1);
  });

  it("drops a fall whose plan was still in flight when a cancel landed", async () => {
    const h = makeHarness();
    const pending = h.faller.drop();
    h.faller.cancel();
    await pending;

    expect(h.motions).toEqual([]);
    expect(h.positions).toEqual([]);
    expect(h.starts).not.toHaveBeenCalled();
    expect(h.ends).not.toHaveBeenCalled();
  });

  it("ignores a drop while a fall is already running", async () => {
    const h = makeHarness();
    await h.faller.drop();
    await h.faller.drop();
    expect(h.motions).toEqual([{ id: FALL_MOTION_ID }]);
    expect(h.starts).toHaveBeenCalledTimes(1);
  });

  it("reaches the floor even when the clip request never takes", async () => {
    const h = makeHarness({ motionRefused: true });
    await h.faller.drop();
    expect(h.starts).toHaveBeenCalledTimes(1);

    await h.fallToFloor();
    expect(h.positions.at(-1)).toEqual({ x: WINDOW_POS.x, y: GROUNDED_Y });
    expect(h.lands).toHaveBeenCalledWith(780);
    expect(h.ends).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["the feet anchor is unavailable", { feetY: null }],
    ["the character height cannot be probed", { charHpx: null }],
  ])("skips the fall when %s", async (_label, over) => {
    const h = makeHarness(over);
    await h.faller.drop();
    expect(h.motions).toEqual([]);
    expect(h.positions).toEqual([]);
  });

  it("stop() ends a running fall and refuses further drops", async () => {
    const h = makeHarness();
    await h.faller.drop();
    h.faller.stop();
    expect(h.ends).toHaveBeenCalledTimes(1);
    expect(h.hasTick()).toBe(false);

    await h.faller.drop();
    expect(h.starts).toHaveBeenCalledTimes(1);
  });
});
