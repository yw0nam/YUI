import { describe, expect, it, vi } from "vitest";
import type { MotionKind } from "../../contract";
import type { RenderMotionSignal } from "../../renderer";
import { type ClipLeg, createLegRunner } from "./clip-leg";

/** Source clip lengths the renderer reports once the clips are cached. */
const MOTION_S: Record<string, number> = { up: 2, pull: 2, hang: 1 };
/** Hips travel (m, signed) the renderer levelled out of each clip. */
const MOTION_TRAVEL_M: Record<string, number> = { up: 1, pull: 1, hang: 0 };
const MOTION_LOOPS = new Set(["up", "idle"]);
const MOTION_KINDS: Record<string, MotionKind> = {
  idle: "ambient",
  up: "reactive",
  pull: "oneshot",
  hang: "oneshot",
  happy: "oneshot",
  drag: "reactive",
};

function makeHarness() {
  const cached = new Set<string>();
  let clipT = 0;
  let current: { id: string; vrma_path: string } | null = {
    id: "idle",
    vrma_path: "/motions/calm.vrma",
  };
  const motions: Array<RenderMotionSignal | null> = [];
  const positions: Array<{ x: number; y: number }> = [];
  const win = {
    setPositionPhysical: vi.fn(async (x: number, y: number) => {
      positions.push({ x, y });
    }),
  };
  const runner = createLegRunner({
    renderer: {
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
    },
    currentMotionKind: () => (current ? (MOTION_KINDS[current.id] ?? null) : null),
  });
  /** One frame: the clip's own clock runs, a finished oneshot hands the body back. */
  const frame = async (dt = 0.1): Promise<void> => {
    if (current) {
      clipT += dt;
      const duration = MOTION_S[current.id];
      if (duration && clipT >= duration) {
        if (MOTION_LOOPS.has(current.id)) clipT -= duration;
        else current = { id: "idle", vrma_path: "/motions/calm.vrma" };
      }
    }
    runner.step(dt);
    for (let i = 0; i < 4; i++) await Promise.resolve();
  };
  const runFrames = async (n: number, dt = 0.1): Promise<void> => {
    for (let i = 0; i < n; i++) await frame(dt);
  };
  return {
    runner,
    win,
    motions,
    positions,
    frame,
    runFrames,
    setCurrent: (id: string | null) => {
      current = id ? { id, vrma_path: `/motions/${id}.vrma` } : null;
    },
    clipT: () => clipT,
  };
}

function leg(h: ReturnType<typeof makeHarness>, over: Partial<ClipLeg> = {}): ClipLeg {
  return {
    win: h.win,
    fromX: 500,
    toX: 500,
    fromY: 1000,
    toY: 1000,
    motionId: "up",
    phase: "test",
    pxPerMetre: 300,
    linearS: null,
    curveY: true,
    oneshot: false,
    handoffS: 0,
    ...over,
  };
}

/** Settled outcome of a promise, or "pending" while it is still open. */
async function outcome(p: Promise<"done" | "lost">): Promise<"done" | "lost" | "pending"> {
  return Promise.race([p, Promise.resolve().then(() => "pending" as const)]);
}

describe("createLegRunner — clip-paced window legs", () => {
  it("follows the clip's own rise at pxPerMetre and finishes on arrival", async () => {
    const h = makeHarness();
    // Half a metre of the 1 m/2 s clip: 150 px up, reached at t = 1 s.
    const done = h.runner.run(leg(h, { toY: 850 }));
    expect(h.motions).toEqual([{ id: "up" }]);
    await h.runFrames(5);
    expect(h.positions.at(-1)?.y).toBeCloseTo(925, 6);
    expect(await outcome(done)).toBe("pending");
    await h.runFrames(5);
    expect(h.positions.at(-1)).toEqual({ x: 500, y: 850 });
    expect(await outcome(done)).toBe("done");
    expect(h.runner.current()).toBeNull();
  });

  it("counts each loop restart as another whole cycle travelled", async () => {
    const h = makeHarness();
    // 2.5 cycles of the looping 1 m clip: 750 px, reached after 5 s.
    const done = h.runner.run(leg(h, { toY: 250 }));
    await h.runFrames(49);
    expect(await outcome(done)).toBe("pending");
    const ys = h.positions.map((p) => p.y);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeLessThanOrEqual(ys[i - 1]);
    await h.runFrames(2);
    expect(await outcome(done)).toBe("done");
    expect(h.positions.at(-1)?.y).toBe(250);
  });

  it("holds the window while another clip has the body, then finishes a oneshot on the baseline", async () => {
    const h = makeHarness();
    const done = h.runner.run(leg(h, { motionId: "pull", toY: 700, oneshot: true }));
    await h.runFrames(5);
    const held = h.positions.length;
    h.setCurrent("happy");
    await h.runFrames(5);
    expect(h.positions.length).toBe(held);
    expect(await outcome(done)).toBe("pending");
    // The express clip ends: the pull-over is finished, not restarted — take the rest.
    h.setCurrent("idle");
    await h.frame();
    expect(await outcome(done)).toBe("done");
    expect(h.positions.at(-1)).toEqual({ x: 500, y: 700 });
    expect(h.motions).toEqual([{ id: "pull" }]);
  });

  it("replays a looping clip the baseline took back, rebased on where the hold left the window", async () => {
    const h = makeHarness();
    const done = h.runner.run(leg(h, { toY: 400 }));
    await h.runFrames(5);
    const y = h.positions.at(-1)?.y ?? 0;
    h.setCurrent("idle");
    await h.frame();
    expect(h.motions).toEqual([{ id: "up" }, { id: "up" }]);
    await h.runFrames(5);
    // The replay's first frame is its new baseline; the next four move 15 px each.
    expect(h.positions.at(-1)?.y).toBeCloseTo(y - 60, 6);
    expect(await outcome(done)).toBe("pending");
  });

  it("eases a linear leg on its own clock, x and y alike", async () => {
    const h = makeHarness();
    const done = h.runner.run(
      leg(h, { motionId: "hang", fromX: 500, toX: 400, toY: 1100, linearS: 0.4, curveY: false }),
    );
    await h.runFrames(2);
    expect(h.positions.at(-1)).toEqual({ x: 450, y: 1050 });
    await h.runFrames(2);
    expect(h.positions.at(-1)).toEqual({ x: 400, y: 1100 });
    expect(await outcome(done)).toBe("done");
  });

  it("resolves lost when finished from outside", async () => {
    const h = makeHarness();
    const done = h.runner.run(leg(h, { toY: 850 }));
    await h.runFrames(2);
    expect(h.runner.current()).toMatchObject({ phase: "test", x: 500 });
    h.runner.finish("lost");
    expect(await outcome(done)).toBe("lost");
    expect(h.runner.current()).toBeNull();
    const moved = h.positions.length;
    await h.runFrames(2);
    expect(h.positions.length).toBe(moved);
  });

  it("resolves lost at once when the clip does not take", async () => {
    const h = makeHarness();
    h.setCurrent("drag");
    const runner = createLegRunner({
      renderer: {
        playMotion: () => {},
        getCurrentMotion: () => ({ id: "drag", vrma_path: "/motions/drag.vrma" }),
        getCurrentMotionTime: () => 0,
        getMotionDuration: () => null,
        getMotionTravelY: () => null,
        getMotionTravelAt: () => null,
      },
      currentMotionKind: () => "reactive",
    });
    expect(await runner.run(leg(h, { toY: 850 }))).toBe("lost");
  });

  it("is done at once when a leg has nowhere to go", async () => {
    const h = makeHarness();
    expect(await h.runner.run(leg(h))).toBe("done");
    expect(h.motions).toEqual([]);
  });
});
