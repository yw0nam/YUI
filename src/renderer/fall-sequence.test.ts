/**
 * fall-sequence.test.ts — the perched-character fall state machine (#143 U4).
 *
 * Fully dependency-injected: a fake renderer (playMotion + completion signal +
 * onTick), a fake windowMover, a frozen feet measurement, and the real
 * preemption primitive drive the controller with no three.js / Tauri / DOM.
 *
 * State machine under test:
 *   detaching → falling → landing → reacting → idle
 *   (motion ids: "falling" → "landing" → "suneru" → null)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFallSequence, type FallSequenceDeps, FallState } from "./fall-sequence";
import { createMotionPreemption } from "./motion-preemption";
import { LANDING_REACTION_ID, SETPOS_MIN_DELTA_PX, SETPOS_MIN_INTERVAL_S } from "./fall-config";
import type { ScreenRect } from "../contract";

const DT = 1 / 60;

/** A controllable per-frame tick driver — tests pump frames explicitly. */
function createFakeTick() {
  const hooks = new Set<(dt: number) => void>();
  return {
    onTick(fn: (dt: number) => void): () => void {
      hooks.add(fn);
      return () => hooks.delete(fn);
    },
    /** Drive one frame at dt seconds. */
    frame(dt = DT): void {
      for (const fn of [...hooks]) fn(dt);
    },
    /** Drive frames until predicate or cap. */
    pump(pred: () => boolean, dt = DT, cap = 100_000): number {
      let n = 0;
      while (!pred() && n < cap) {
        this.frame(dt);
        n++;
      }
      return n;
    },
    count(): number {
      return hooks.size;
    },
  };
}

/**
 * A fake renderer motion driver: records playMotion calls and lets the test
 * resolve a clip's completion deterministically via finish(id).
 */
function createFakeRenderer() {
  const played: Array<string | null> = [];
  const waiters = new Map<string, Array<() => void>>();
  return {
    played,
    playMotion(id: string | null): void {
      played.push(id);
    },
    whenMotionFinished(id: string): Promise<void> {
      return new Promise<void>((resolve) => {
        const list = waiters.get(id) ?? [];
        list.push(resolve);
        waiters.set(id, list);
      });
    },
    /** Resolve every pending wait for `id`. */
    finish(id: string): void {
      const list = waiters.get(id);
      if (!list) return;
      waiters.delete(id);
      for (const r of list) r();
    },
    lastPlayed(): string | null | undefined {
      return played[played.length - 1];
    },
  };
}

const WORK_AREA: ScreenRect = { x: 0, y: 0, width: 1920, height: 1080 };

function createFakeMover(overrides?: {
  winY?: number;
  winH?: number;
  workArea?: ScreenRect;
  failWorkArea?: boolean;
  failGeom?: boolean;
  failSetPosition?: boolean;
}) {
  const winY = overrides?.winY ?? 100;
  const winH = overrides?.winH ?? 400;
  const workArea = overrides?.workArea ?? WORK_AREA;
  const setPosition = vi.fn(async (_x: number, _y: number) => {
    if (overrides?.failSetPosition) throw new Error("setPosition failed");
  });
  return {
    setPosition,
    getWorkArea: vi.fn(async () => {
      if (overrides?.failWorkArea) throw new Error("getWorkArea failed");
      return { ...workArea, scaleFactor: 1 };
    }),
    getWindowGeom: vi.fn(async () => {
      if (overrides?.failGeom) throw new Error("getWindowGeom failed");
      return { x: workArea.x, y: winY, w: 300, h: winH, scale: 1 };
    }),
  };
}

/** Assemble deps with sensible defaults; pieces overridable per test. */
function makeDeps(
  partial?: Partial<FallSequenceDeps> & {
    renderer?: ReturnType<typeof createFakeRenderer>;
    tick?: ReturnType<typeof createFakeTick>;
    mover?: ReturnType<typeof createFakeMover>;
    preemption?: ReturnType<typeof createMotionPreemption>;
    feetPx?: number;
    reducedMotion?: boolean;
  },
): {
  deps: FallSequenceDeps;
  renderer: ReturnType<typeof createFakeRenderer>;
  tick: ReturnType<typeof createFakeTick>;
  mover: ReturnType<typeof createFakeMover>;
  preemption: ReturnType<typeof createMotionPreemption>;
} {
  const renderer = partial?.renderer ?? createFakeRenderer();
  const tick = partial?.tick ?? createFakeTick();
  const mover = partial?.mover ?? createFakeMover();
  const preemption = partial?.preemption ?? createMotionPreemption();
  // feet far enough below window top that a real fall happens by default.
  const feetPx = partial?.feetPx ?? 380;

  const deps: FallSequenceDeps = {
    playMotion: renderer.playMotion.bind(renderer),
    whenMotionFinished: renderer.whenMotionFinished.bind(renderer),
    windowMover: mover,
    measureFeetPx: () => feetPx,
    onTick: tick.onTick.bind(tick),
    onMotionPreempted: preemption.onMotionPreempted,
    motionGeneration: preemption.generation,
    isMotionGenerationCurrent: preemption.isCurrent,
    reducedMotion: partial?.reducedMotion ?? false,
  };
  return { deps, renderer, tick, mover, preemption };
}

/** Flush microtasks so awaited promises in the controller settle. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("createFallSequence — fall state machine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("happy path", () => {
    it("transitions detaching→falling→landing→reacting→idle with ids falling→landing→suneru→null", async () => {
      const { deps, renderer, tick } = makeDeps();
      const seq = createFallSequence(deps);
      seq.start();
      await flush(); // resolve geometry, enter falling

      expect(renderer.played[0]).toBe("falling");
      expect(seq.state()).toBe(FallState.Falling);

      // drive the fall to completion → landing
      tick.pump(() => seq.state() !== FallState.Falling);
      await flush();
      expect(renderer.played).toContain("landing");
      expect(seq.state()).toBe(FallState.Landing);

      // landing clip finishes → reacting (suneru)
      renderer.finish("landing");
      await flush();
      expect(renderer.lastPlayed()).toBe(LANDING_REACTION_ID);
      expect(seq.state()).toBe(FallState.Reacting);

      // suneru finishes → idle (playMotion(null))
      renderer.finish(LANDING_REACTION_ID);
      await flush();
      expect(renderer.lastPlayed()).toBe(null);
      expect(seq.state()).toBe(FallState.Idle);

      // ordered sequence
      expect(renderer.played).toEqual(["falling", "landing", LANDING_REACTION_ID, null]);
    });

    it("unregisters the tick hook once the fall completes", async () => {
      const { deps, tick, renderer } = makeDeps();
      const seq = createFallSequence(deps);
      seq.start();
      await flush();
      expect(tick.count()).toBe(1);
      tick.pump(() => seq.state() !== FallState.Falling);
      await flush();
      expect(tick.count()).toBe(0);
      // draining the rest leaves no armed tick
      renderer.finish("landing");
      await flush();
      renderer.finish(LANDING_REACTION_ID);
      await flush();
      expect(tick.count()).toBe(0);
    });

    it("steps the window Y via setPosition during the fall", async () => {
      const { deps, mover, tick, renderer, preemption } = makeDeps();
      void preemption;
      const seq = createFallSequence(deps);
      seq.start();
      await flush();
      tick.pump(() => seq.state() !== FallState.Falling);
      await flush();
      void renderer;
      expect(mover.setPosition.mock.calls.length).toBeGreaterThan(0);
      // last Y issued lands at/above the work-area bottom minus window height
      const lastCall = mover.setPosition.mock.calls.at(-1)!;
      expect(lastCall[1]).toBeLessThanOrEqual(WORK_AREA.height);
    });
  });

  describe("skipFall short-circuit", () => {
    it("skips falling and goes straight to landing→suneru when already at/below bottom", async () => {
      // window already at the bottom: winY large + small feetPx → distance <= 0
      const mover = createFakeMover({ winY: 700, winH: 400 });
      const { deps, renderer, tick } = makeDeps({ mover, feetPx: 380 });
      const seq = createFallSequence(deps);
      seq.start();
      await flush();

      expect(renderer.played).not.toContain("falling");
      expect(renderer.played[0]).toBe("landing");
      expect(seq.state()).toBe(FallState.Landing);
      // no tick armed for a skipped fall
      expect(tick.count()).toBe(0);

      renderer.finish("landing");
      await flush();
      expect(renderer.lastPlayed()).toBe(LANDING_REACTION_ID);
      renderer.finish(LANDING_REACTION_ID);
      await flush();
      expect(seq.state()).toBe(FallState.Idle);
    });
  });

  describe("reduced-motion", () => {
    it("does a single instant setPosition (no falling clip) then land-reacts", async () => {
      const mover = createFakeMover();
      const { deps, renderer, tick } = makeDeps({ mover, reducedMotion: true });
      const seq = createFallSequence(deps);
      seq.start();
      await flush();

      // no falling clip, no per-frame tick
      expect(renderer.played).not.toContain("falling");
      expect(tick.count()).toBe(0);
      // exactly one snap to the bottom
      expect(mover.setPosition).toHaveBeenCalledTimes(1);
      // then land-react, not straight idle
      expect(renderer.played[0]).toBe("landing");
      expect(seq.state()).toBe(FallState.Landing);

      renderer.finish("landing");
      await flush();
      expect(renderer.lastPlayed()).toBe(LANDING_REACTION_ID);
      renderer.finish(LANDING_REACTION_ID);
      await flush();
      expect(seq.state()).toBe(FallState.Idle);
    });
  });

  describe("fallbacks to idle (must-fix #5)", () => {
    it("windowMover undefined → playMotion(null) → idle, no falling", async () => {
      const { deps, renderer } = makeDeps();
      const noMover: FallSequenceDeps = { ...deps, windowMover: undefined };
      const seq = createFallSequence(noMover);
      seq.start();
      await flush();
      expect(renderer.played).toEqual([null]);
      expect(seq.state()).toBe(FallState.Idle);
    });

    it("getWorkArea failure → idle fallback", async () => {
      const mover = createFakeMover({ failWorkArea: true });
      const { deps, renderer } = makeDeps({ mover });
      const seq = createFallSequence(deps);
      seq.start();
      await flush();
      expect(renderer.played).toEqual([null]);
      expect(seq.state()).toBe(FallState.Idle);
    });

    it("getWindowGeom failure → idle fallback", async () => {
      const mover = createFakeMover({ failGeom: true });
      const { deps, renderer } = makeDeps({ mover });
      const seq = createFallSequence(deps);
      seq.start();
      await flush();
      expect(renderer.played).toEqual([null]);
      expect(seq.state()).toBe(FallState.Idle);
    });
  });

  describe("interrupt / cancel (must-fix #4)", () => {
    it("preemption mid-fall cancels the tick and aborts the react (no suneru, no forced idle)", async () => {
      const { deps, renderer, tick, preemption } = makeDeps();
      const seq = createFallSequence(deps);
      seq.start();
      await flush();
      expect(seq.state()).toBe(FallState.Falling);

      // user re-grab: drag replaces falling
      preemption.preempt("falling", "drag");
      await flush();

      // tick gone, no further motion commands from the controller
      expect(tick.count()).toBe(0);
      expect(renderer.played).not.toContain("landing");
      expect(renderer.played).not.toContain(LANDING_REACTION_ID);
      // does NOT force idle — the takeover owns the character
      expect(renderer.played).not.toContain(null);
      expect(seq.state()).toBe(FallState.Cancelled);
    });

    it("cancel() mid-fall unregisters the tick and stops transitions", async () => {
      const { deps, renderer, tick } = makeDeps();
      const seq = createFallSequence(deps);
      seq.start();
      await flush();
      expect(seq.state()).toBe(FallState.Falling);

      seq.cancel();
      expect(tick.count()).toBe(0);
      expect(seq.state()).toBe(FallState.Cancelled);

      // landing clip resolving after cancel must not advance the machine
      renderer.finish("landing");
      await flush();
      expect(renderer.played).not.toContain(LANDING_REACTION_ID);
      expect(seq.state()).toBe(FallState.Cancelled);
    });

    it("re-entrant start() while active is ignored (idempotent)", async () => {
      const { deps, renderer, tick } = makeDeps();
      const seq = createFallSequence(deps);
      seq.start();
      await flush();
      const playedCount = renderer.played.length;
      const tickCount = tick.count();

      seq.start(); // ignored
      await flush();
      expect(renderer.played.length).toBe(playedCount);
      expect(tick.count()).toBe(tickCount);
      expect(seq.state()).toBe(FallState.Falling);
    });

    it("preemption during landing aborts the react", async () => {
      const { deps, renderer, tick, preemption } = makeDeps();
      const seq = createFallSequence(deps);
      seq.start();
      await flush();
      tick.pump(() => seq.state() !== FallState.Falling);
      await flush();
      expect(seq.state()).toBe(FallState.Landing);

      preemption.preempt("landing", "drag");
      await flush();
      // landing clip resolves after the takeover — must not play suneru
      renderer.finish("landing");
      await flush();
      expect(renderer.played).not.toContain(LANDING_REACTION_ID);
      expect(seq.state()).toBe(FallState.Cancelled);
    });
  });

  describe("cadence throttle (absorbs U6)", () => {
    it("throttles setPosition to the min-interval and min-delta gates while computing Y every frame", async () => {
      const { deps, mover, tick } = makeDeps({ feetPx: 380 });
      const seq = createFallSequence(deps);
      seq.start();
      await flush();

      const frames = tick.pump(() => seq.state() !== FallState.Falling);
      await flush();

      const calls = mover.setPosition.mock.calls.length;
      // every issued Y respects the min-delta gate (monotone, spaced >= delta)
      const ys = mover.setPosition.mock.calls.map((c) => c[1] as number);
      for (let i = 1; i < ys.length; i++) {
        // final clamp call may be < delta (snap to target) — allow the last one
        if (i < ys.length - 1) {
          expect(Math.abs(ys[i] - ys[i - 1])).toBeGreaterThanOrEqual(SETPOS_MIN_DELTA_PX - 1e-6);
        }
      }
      // throttled well under one-call-per-frame
      const maxByInterval = Math.ceil((frames * DT) / SETPOS_MIN_INTERVAL_S) + 2;
      expect(calls).toBeLessThanOrEqual(maxByInterval);
      expect(calls).toBeLessThan(frames);
    });

    it("a setPosition that resolves stale (generation bumped) is discarded — no further stepping", async () => {
      // slow setPosition: resolves only when we release it, after a generation bump.
      let release: (() => void) | null = null;
      const gatedSetPosition = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      const mover = createFakeMover();
      mover.setPosition = gatedSetPosition as unknown as typeof mover.setPosition;
      const { deps, renderer, tick, preemption } = makeDeps({ mover });
      const seq = createFallSequence(deps);
      seq.start();
      await flush();

      // advance until the first setPosition is in flight
      tick.pump(() => gatedSetPosition.mock.calls.length > 0, DT, 1000);
      expect(release).not.toBeNull();

      // generation goes stale, THEN the in-flight setPosition resolves
      preemption.preempt("falling", "drag");
      release!();
      await flush();

      // the stale resolve is discarded: no landing, machine cancelled
      expect(renderer.played).not.toContain("landing");
      expect(seq.state()).toBe(FallState.Cancelled);
    });
  });
});
