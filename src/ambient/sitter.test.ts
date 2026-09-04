import { describe, expect, it, vi } from "vitest";
import type { MotionKind } from "../contract";
import type { RenderMotionSignal, TickContext, TickFn } from "../renderer";
import {
  createSitter,
  SEAT_HANDOFF_S,
  SIT_DOWN_MOTION_ID,
  type SitterDeps,
  STAND_UP_MOTION_ID,
} from "./sitter";

const MOTION_S: Record<string, number> = { sit_down: 4.4, stand_up: 2.0 };
const MOTION_TRAVEL_M: Record<string, number> = { sit_down: -0.34, stand_up: 0.4 };
const MOTION_KINDS: Record<string, MotionKind> = {
  idle: "ambient",
  sit_down: "oneshot",
  stand_up: "oneshot",
  drag: "reactive",
  walk: "reactive",
};

/** Feet and seat in canvas-local logical px while standing: the seat is 120 px up. */
const ANCHOR = { x: 200, y: 420 };
const SEAT = { x: 200, y: 300 };

function makeHarness(over: { anchor?: null; probe?: null } = {}) {
  let tick: TickFn | null = null;
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
  const cached = new Set<string>();
  let clipT = 0;
  let current: { id: string; vrma_path: string } | null = {
    id: "idle",
    vrma_path: "/motions/calm.vrma",
  };
  const motions: Array<RenderMotionSignal | null> = [];
  const preloads: string[] = [];
  const positions: Array<{ x: number; y: number }> = [];
  let pos = { x: 1000, y: 600 };
  const win = {
    outerPosition: vi.fn(async () => ({ ...pos })),
    setPositionPhysical: vi.fn(async (x: number, y: number) => {
      pos = { x, y };
      positions.push({ x, y });
    }),
  };
  const deps: SitterDeps = {
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
        current = m ? { id: m.id, vrma_path: `/motions/${m.id}.vrma` } : null;
        clipT = 0;
      },
      getCurrentMotion: () => current,
      getCurrentMotionTime: () => (current ? clipT : null),
      getMotionDuration: (id) => (cached.has(id) ? (MOTION_S[id] ?? null) : null),
      getMotionTravelY: (id) => (cached.has(id) ? (MOTION_TRAVEL_M[id] ?? 0) : null),
      getMotionTravelAt: (id, t) => {
        if (!cached.has(id)) return null;
        const total = MOTION_TRAVEL_M[id] ?? 0;
        return total * Math.min(Math.max(t, 0) / (MOTION_S[id] ?? 1), 1);
      },
      preloadMotion: async (id) => {
        preloads.push(id);
        cached.add(id);
      },
      getCharacterAnchor: () => (over.anchor === null ? null : ANCHOR),
      getPerchProbe: () => (over.probe === null ? null : { seatPx: SEAT, charHpx: 500 }),
    },
    currentMotionKind: () => (current ? (MOTION_KINDS[current.id] ?? null) : null),
    doc,
  };
  const sitter = createSitter(deps);
  let elapsed = 0;
  const frame = async (dt = 0.1): Promise<void> => {
    elapsed += dt;
    if (current) {
      clipT += dt;
      const duration = MOTION_S[current.id];
      if (duration && clipT >= duration) current = { id: "idle", vrma_path: "/motions/calm.vrma" };
    }
    tick?.({ vrm: {} as never, dt, elapsed } as TickContext);
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };
  const runFrames = async (n: number): Promise<void> => {
    for (let i = 0; i < n; i++) await frame();
  };
  return {
    sitter,
    win,
    motions,
    preloads,
    positions,
    frame,
    runFrames,
    at: () => ({ ...pos }),
    clipT: () => clipT,
    setCurrent: (id: string) => {
      current = { id, vrma_path: `/motions/${id}.vrma` };
    },
    hide: () => {
      doc.visibilityState = "hidden";
      for (const cb of visibilityListeners) cb();
    },
    listeners: () => visibilityListeners.size,
  };
}

async function outcome(p: Promise<"done" | "lost">): Promise<"done" | "lost" | "pending"> {
  return Promise.race([p, Promise.resolve().then(() => "pending" as const)]);
}

describe("createSitter", () => {
  it("sits down along the clip's curve, the window dropping by the standing seat height", async () => {
    const h = makeHarness();
    h.sitter.start();
    // Seat 120 px above the feet at scale 2: the window has 240 physical px to sink.
    const done = h.sitter.sitDown({ win: h.win, scale: 2 });
    await h.frame();
    expect(h.preloads).toEqual([SIT_DOWN_MOTION_ID]);
    expect(h.motions).toEqual([{ id: SIT_DOWN_MOTION_ID }]);
    await h.runFrames(21);
    // Part way down the clip, the same part of the way down the drop.
    expect(h.positions.at(-1)?.y).toBeCloseTo(600 + (240 * h.clipT()) / MOTION_S.sit_down, 0);
    expect(await outcome(done)).toBe("pending");
    await h.runFrames(18);
    expect(h.clipT()).toBeGreaterThanOrEqual(MOTION_S.sit_down - SEAT_HANDOFF_S);
    expect(await outcome(done)).toBe("done");
    expect(h.at()).toEqual({ x: 1000, y: 840 });
  });

  it("plays the sit in place when given no window", async () => {
    const h = makeHarness();
    h.sitter.start();
    const done = h.sitter.sitDown(null);
    await h.frame();
    expect(h.motions).toEqual([{ id: SIT_DOWN_MOTION_ID }]);
    await h.runFrames(39);
    expect(await outcome(done)).toBe("done");
    expect(h.positions).toEqual([]);
  });

  it("plays the sit in place when the body cannot be measured", async () => {
    const h = makeHarness({ probe: null });
    h.sitter.start();
    const done = h.sitter.sitDown({ win: h.win, scale: 1 });
    await h.runFrames(40);
    expect(await outcome(done)).toBe("done");
    expect(h.positions).toEqual([]);
  });

  it("stands up along the clip's curve to the standing origin", async () => {
    const h = makeHarness();
    h.sitter.start();
    const done = h.sitter.standUp(h.win, 400);
    await h.frame();
    expect(h.preloads).toEqual([STAND_UP_MOTION_ID]);
    expect(h.motions).toEqual([{ id: STAND_UP_MOTION_ID }]);
    await h.runFrames(10);
    expect(h.positions.at(-1)?.y).toBeCloseTo(600 - (200 * h.clipT()) / MOTION_S.stand_up, 0);
    await h.runFrames(5);
    expect(h.clipT()).toBeGreaterThanOrEqual(MOTION_S.stand_up - SEAT_HANDOFF_S);
    expect(await outcome(done)).toBe("done");
    expect(h.at()).toEqual({ x: 1000, y: 400 });
  });

  it("ends a running transition as lost on cancel and hands the clip back", async () => {
    const h = makeHarness();
    h.sitter.start();
    const done = h.sitter.sitDown({ win: h.win, scale: 1 });
    await h.runFrames(5);
    const moved = h.positions.length;
    h.sitter.cancel();
    expect(await outcome(done)).toBe("lost");
    expect(h.motions.at(-1)).toBeNull();
    await h.runFrames(5);
    expect(h.positions.length).toBe(moved);
  });

  it("leaves a clip that is not its own alone on cancel", async () => {
    const h = makeHarness();
    h.sitter.start();
    const done = h.sitter.sitDown({ win: h.win, scale: 1 });
    await h.runFrames(5);
    h.setCurrent("drag");
    h.sitter.cancel();
    expect(await outcome(done)).toBe("lost");
    expect(h.motions).toEqual([{ id: SIT_DOWN_MOTION_ID }]);
  });

  it("loses a transition that is still loading when cancelled", async () => {
    const h = makeHarness();
    h.sitter.start();
    const done = h.sitter.sitDown({ win: h.win, scale: 1 });
    h.sitter.cancel();
    await h.runFrames(2);
    expect(await outcome(done)).toBe("lost");
    expect(h.motions).toEqual([]);
  });

  it("gives way to a fresh transition", async () => {
    const h = makeHarness();
    h.sitter.start();
    const first = h.sitter.sitDown({ win: h.win, scale: 1 });
    await h.runFrames(3);
    const second = h.sitter.standUp(h.win, 400);
    await h.runFrames(2);
    expect(await outcome(first)).toBe("lost");
    expect(await outcome(second)).toBe("pending");
    // The first hands its clip back on the way out.
    expect(h.motions.map((m) => m?.id ?? null)).toEqual([
      SIT_DOWN_MOTION_ID,
      null,
      STAND_UP_MOTION_ID,
    ]);
  });

  it("loses a running transition when the document hides, so no caller waits on a parked tick", async () => {
    const h = makeHarness();
    h.sitter.start();
    const done = h.sitter.sitDown({ win: h.win, scale: 1 });
    await h.runFrames(5);
    h.hide();
    expect(await outcome(done)).toBe("lost");
    expect(h.motions.at(-1)).toBeNull();
  });

  it("listens for visibility only while started", async () => {
    const h = makeHarness();
    expect(h.listeners()).toBe(0);
    h.sitter.start();
    expect(h.listeners()).toBe(1);
    h.sitter.stop();
    expect(h.listeners()).toBe(0);
  });

  it("moves nothing once stopped", async () => {
    const h = makeHarness();
    h.sitter.start();
    const done = h.sitter.sitDown({ win: h.win, scale: 1 });
    await h.runFrames(2);
    h.sitter.stop();
    expect(await outcome(done)).toBe("lost");
  });
});
