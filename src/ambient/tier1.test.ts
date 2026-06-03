import { describe, it, expect, vi } from "vitest";
import { createTier1Engine, type Tier1Engine } from "./tier1";
import type { Renderer, TickFn, TickContext } from "../renderer";

/**
 * Tier1 엔진을 **헤드리스로 결정적 구동**한다 (브라우저/ rAF 없이).
 * fake renderer가 onTick(fn)을 붙잡고, fake VRM에 합성 프레임을 흘려 보낸다.
 * → cues 단위 테스트보다 강한 통합 검증: 엔진이 실제로 bone을 움직이고 blink하며
 *   trigger에 반응하는지. (preview 환경은 rAF를 throttle하므로 거기선 검증 불가.)
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

/** onTick을 붙잡는 최소 fake renderer. */
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

/** 합성 프레임 구동기: 60fps로 durationS초 동안 tick 호출, 샘플 수집. elapsed는 호출 간 누적. */
function drive(
  tick: TickFn,
  m: ReturnType<typeof makeVrm>,
  durationS: number,
  fps = 60,
) {
  const dt = 1 / fps;
  const n = Math.round(durationS * fps);
  const samples: Array<{ elapsed: number; headY: number; headX: number; spineX: number; chestX: number; blink: number }> = [];
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
    const { renderer, getTick } = makeRenderer();
    const m = makeVrm();
    createTier1Engine(renderer).start();
    const samples = drive(getTick(), m, 7);
    const blinkMax = Math.max(...samples.map((s) => s.blink));
    // 60fps로 150ms 삼각 펄스를 샘플링하면 정점(75ms)에 프레임이 정확히 안 맞아
    // 한 프레임 최대치는 ~0.89가 한계 — 눈은 사실상 다 감긴다.
    expect(blinkMax).toBeGreaterThan(0.85);
    // and re-opens (not stuck shut)
    expect(samples[samples.length - 1].blink).toBeLessThan(0.1);
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
    // advance ~110ms (≈ bob peak at 220ms/2) → big deviation
    const peak = drive(tick, m, 0.11);
    const peakX = peak[peak.length - 1].headX;
    expect(Math.abs(peakX - before)).toBeGreaterThan(0.05); // bob is visible

    // after the bob fully elapses, pitch returns to sway-only magnitude
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
