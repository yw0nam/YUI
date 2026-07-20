import { describe, expect, it, vi } from "vitest";
import type { Renderer, TickContext, TickFn } from "../renderer";
import { createTier1Engine, type Tier1Engine } from "./tier1";

/**
 * Drive Tier1 engine **headless deterministically** (without browser / rAF).
 * fake renderer captures onTick(fn), flow synthetic frames through fake VRM.
 * → Stronger integration validation than cue-unit tests: does engine actually move bones, blink,
 *   and react to triggers? (preview environment throttles rAF, so can't validate there.)
 */

interface FakeBone {
  rotation: {
    x: number;
    y: number;
    z: number;
    set(x: number, y: number, z: number): void;
  };
}
function makeBone(): FakeBone {
  const r = {
    x: 0,
    y: 0,
    z: 0,
    set(x: number, y: number, z: number) {
      r.x = x;
      r.y = y;
      r.z = z;
    },
  };
  return { rotation: r };
}

function makeVrm(opts: { blink?: boolean } = {}) {
  const blink = opts.blink ?? true;
  const bones: Record<string, FakeBone> = {
    head: makeBone(),
    spine: makeBone(),
    chest: makeBone(),
    upperChest: makeBone(),
  };
  const exprValues: Record<string, number> = {};
  const present = new Set(blink ? ["blink"] : []);
  const vrm = {
    humanoid: {
      getNormalizedBoneNode: (name: string) => bones[name] ?? null,
    },
    expressionManager: {
      getExpression: (name: string) => (present.has(name) ? {} : null),
      setValue: (name: string, v: number) => {
        exprValues[name] = v;
      },
      getValue: (name: string) => exprValues[name] ?? 0,
    },
  };
  return { vrm, bones, exprValues, elapsed: 0 };
}

/** Minimal fake renderer that captures onTick. */
function makeRenderer(): { renderer: Renderer; getTick: () => TickFn } {
  let tick: TickFn | null = null;
  const renderer = {
    onTick: (fn: TickFn) => {
      tick = fn;
      return () => {
        tick = null;
      };
    },
    loadVRM: async () => {},
    applyDirective: () => {},
    setEmotion: () => {},
    playMotion: () => {},
    dispose: () => {},
  } as unknown as Renderer;
  return { renderer, getTick: () => tick! };
}

/** Synthetic frame driver: call tick for durationS seconds at 60fps, collect samples. elapsed accumulates between calls. */
function drive(tick: TickFn, m: ReturnType<typeof makeVrm>, durationS: number, fps = 60) {
  const dt = 1 / fps;
  const n = Math.round(durationS * fps);
  const samples: Array<{
    elapsed: number;
    headY: number;
    headX: number;
    spineX: number;
    chestX: number;
    blink: number;
  }> = [];
  for (let i = 0; i < n; i++) {
    m.elapsed += dt;
    const ctx: TickContext = { vrm: m.vrm as never, dt, elapsed: m.elapsed };
    tick(ctx);
    samples.push({
      elapsed: m.elapsed,
      headY: m.bones.head.rotation.y,
      headX: m.bones.head.rotation.x,
      spineX: m.bones.spine.rotation.x,
      chestX: m.bones.upperChest.rotation.x,
      blink: m.exprValues.blink ?? 0,
    });
  }
  return samples;
}

const range = (a: number[]) => Math.max(...a) - Math.min(...a);

describe("Tier1Engine — drives a VRM (headless)", () => {
  it("registers a single onTick hook on start, unregisters on stop", () => {
    const { renderer } = makeRenderer();
    const spy = vi.spyOn(renderer, "onTick");
    const unsub = vi.fn();
    spy.mockReturnValue(unsub);
    const engine: Tier1Engine = createTier1Engine(renderer);
    engine.start();
    expect(spy).toHaveBeenCalledOnce();
    engine.start(); // idempotent
    expect(spy).toHaveBeenCalledOnce();
    engine.stop();
    expect(unsub).toHaveBeenCalledOnce();
  });

  it("idle_sway + breath continuously move head/spine/chest (alive, not frozen)", () => {
    const { renderer, getTick } = makeRenderer();
    const m = makeVrm();
    createTier1Engine(renderer).start();
    const samples = drive(getTick(), m, 6);

    expect(range(samples.map((s) => s.headY))).toBeGreaterThan(0.01); // yaw sways
    expect(range(samples.map((s) => s.headX))).toBeGreaterThan(0.01); // pitch sways
    expect(range(samples.map((s) => s.chestX))).toBeGreaterThan(0.005); // breath
  });

  it("blinks at least once within ~7s and reaches near-full closure", () => {
    // Pin rng: blink schedule is Math.random-based, and an unlucky second blink
    // can straddle the final frame. 0.5 → blink at 4.5s, next at ~9.15s (outside window).
    const rand = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const { renderer, getTick } = makeRenderer();
      const m = makeVrm();
      createTier1Engine(renderer).start();
      const samples = drive(getTick(), m, 7);
      const blinkMax = Math.max(...samples.map((s) => s.blink));
      // Sampling 150ms triangle pulse at 60fps, frame doesn't align exactly at peak (75ms),
      // so max per frame is ~0.89 limit — eyes effectively fully closed.
      expect(blinkMax).toBeGreaterThan(0.85);
      // and re-opens (not stuck shut)
      expect(samples[samples.length - 1].blink).toBeLessThan(0.1);
    } finally {
      rand.mockRestore();
    }
  });

  it("tap_react one-shot adds a transient head pitch bob, then settles back", () => {
    const { renderer, getTick } = makeRenderer();
    const m = makeVrm();
    const engine = createTier1Engine(renderer);
    engine.start();
    const tick = getTick();

    // baseline pitch at t≈2.0s (sway only)
    drive(tick, m, 2);
    const before = m.bones.head.rotation.x;

    engine.trigger("tap_react");
    // advance ~110ms (≈ bob peak at 220ms/2) → large deviation
    const peak = drive(tick, m, 0.11);
    const peakX = peak[peak.length - 1].headX;
    expect(Math.abs(peakX - before)).toBeGreaterThan(0.05); // bob is visible

    // After bob fully elapses, pitch returns to sway-only magnitude
    drive(tick, m, 0.5);
    const after = m.bones.head.rotation.x;
    expect(Math.abs(after)).toBeLessThan(0.1);
  });

  it("gracefully no-ops on a VRM without a blink expression", () => {
    const { renderer, getTick } = makeRenderer();
    const m = makeVrm({ blink: false });
    createTier1Engine(renderer).start();
    expect(() => drive(getTick(), m, 5)).not.toThrow();
    expect(m.exprValues.blink).toBeUndefined(); // never written
    // bones still move (sway independent of expressions)
    const samples = drive(getTick(), m, 3);
    expect(range(samples.map((s) => s.headY))).toBeGreaterThan(0.01);
  });
});
