/**
 * motion-controller.test.ts — TDD red phase.
 *
 * These tests MUST FAIL against the stub in motion-controller.ts.
 * They encode the contract that the Renderer agent must implement.
 *
 * Conventions:
 *  - Small synthetic registries for interrupt-policy edge cases.
 *  - Real configs/motions.json (loaded with readFileSync) for variant / idle cases.
 *  - `rng` is injected for deterministic variant selection.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createMotionController,
  type MotionController,
  type ResolvedMotion,
  type MotionDecision,
} from "./motion-controller";
import type { MotionRegistry } from "../contract";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Load the real motions.json from the project root (vitest cwd = project root). */
const realRegistry: MotionRegistry = JSON.parse(
  readFileSync(resolve(process.cwd(), "configs/motions.json"), "utf-8"),
);

/** Synthetic registry for interrupt-policy edge cases. Priorities: idle=0, drag=80, happy=70. */
const syntheticRegistry: MotionRegistry = {
  idle: {
    vrma_path: "/motions/idle_01.vrma",
    variants: [
      "/motions/idle_01.vrma",
      "/motions/idle_02.vrma",
      "/motions/idle_03.vrma",
    ],
    variant_policy: "random",
    kind: "ambient",
    loop: true,
    priority: 0,
    interrupt_policy: "replace",
  },
  drag: {
    vrma_path: "/motions/drag.vrma",
    kind: "reactive",
    loop: true,
    priority: 80,
    interrupt_policy: "replace",
  },
  happy: {
    vrma_path: "/motions/happy.vrma",
    kind: "oneshot",
    loop: false,
    priority: 70,
    interrupt_policy: "replace",
  },
  low_ignore: {
    vrma_path: "/motions/low_ignore.vrma",
    kind: "oneshot",
    loop: false,
    priority: 10,
    interrupt_policy: "ignore",
  },
  low_queue: {
    vrma_path: "/motions/low_queue.vrma",
    kind: "oneshot",
    loop: false,
    priority: 10,
    interrupt_policy: "queue",
  },
  low_replace: {
    vrma_path: "/motions/low_replace.vrma",
    kind: "oneshot",
    loop: false,
    priority: 10,
    interrupt_policy: "replace",
  },
};

/** Fixed 5-variant idle registry — variant-index assertions stay stable as the
 * real configs/motions.json idle pool grows. */
const variantRegistry: MotionRegistry = {
  idle: {
    vrma_path: "/motions/idle_01.vrma",
    variants: [
      "/motions/idle_01.vrma",
      "/motions/idle_02.vrma",
      "/motions/idle_03.vrma",
      "/motions/idle_04.vrma",
      "/motions/idle_05.vrma",
    ],
    variant_policy: "random",
    kind: "ambient",
    loop: true,
    priority: 0,
    interrupt_policy: "replace",
  },
  drag: {
    vrma_path: "/motions/drag.vrma",
    kind: "reactive",
    loop: true,
    priority: 80,
    interrupt_policy: "replace",
  },
};

/** Registry exercising window_sit (state, loop, ≥2 variants, priority 55) against
 * the existing state-machine: baseline idle + a p70 oneshot interrupter. */
const sitRegistry: MotionRegistry = {
  idle: {
    vrma_path: "/motions/idle_01.vrma",
    variants: ["/motions/idle_01.vrma", "/motions/idle_02.vrma"],
    variant_policy: "random",
    kind: "ambient",
    loop: true,
    priority: 0,
    interrupt_policy: "replace",
  },
  window_sit: {
    vrma_path: "/motions/sit_01.vrma",
    variants: ["/motions/sit_01.vrma", "/motions/sit_02.vrma"],
    variant_policy: "random",
    cycle_dwell_ms: 4000,
    kind: "state",
    loop: true,
    priority: 55,
    interrupt_policy: "replace",
  },
  wave: {
    vrma_path: "/motions/wave.vrma",
    kind: "oneshot",
    loop: false,
    priority: 70,
    interrupt_policy: "replace",
  },
};

/** Registry with 3-variant sequential entry for sequential cycling tests. */
const seqRegistry: MotionRegistry = {
  idle: {
    vrma_path: "/motions/idle_01.vrma",
    kind: "ambient",
    loop: true,
    priority: 0,
    interrupt_policy: "replace",
  },
  seq_anim: {
    vrma_path: "/motions/seq_a.vrma",
    variants: ["/motions/seq_a.vrma", "/motions/seq_b.vrma", "/motions/seq_c.vrma"],
    variant_policy: "sequential",
    kind: "oneshot",
    loop: false,
    priority: 50,
    interrupt_policy: "replace",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// §1  resolve() — registry defaults
// ─────────────────────────────────────────────────────────────────────────────

describe("resolve() — registry defaults applied", () => {
  it("resolve({id:'drag'}) returns full ResolvedMotion with registry defaults", () => {
    const mc = createMotionController(realRegistry);
    const r = mc.resolve({ id: "drag" });
    expect(r).not.toBeNull();
    expect(r!.id).toBe("drag");
    expect(r!.loop).toBe(true);
    expect(r!.speed).toBe(1);
    expect(r!.fade_ms).toBe(200);
    expect(r!.priority).toBe(80);
    expect(r!.kind).toBe("reactive");
    expect(r!.interrupt_policy).toBe("replace");
    expect(r!.vrma_path).toBe("/motions/drag.vrma");
  });

  it("signal overrides: loop/speed/fade_ms override registry defaults for drag", () => {
    const mc = createMotionController(realRegistry);
    const r = mc.resolve({ id: "drag", loop: false, speed: 2, fade_ms: 50 });
    expect(r).not.toBeNull();
    expect(r!.loop).toBe(false);
    expect(r!.speed).toBe(2);
    expect(r!.fade_ms).toBe(50);
  });

  it("speed clamp high: speed:9 is clamped to 2.5 and warn is called once", () => {
    const warn = vi.fn();
    const mc = createMotionController(realRegistry, { warn });
    const r = mc.resolve({ id: "happy", speed: 9 });
    expect(r).not.toBeNull();
    expect(r!.speed).toBe(2.5);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("speed clamp low: speed:0.01 is clamped to 0.25", () => {
    const warn = vi.fn();
    const mc = createMotionController(realRegistry, { warn });
    const r = mc.resolve({ id: "happy", speed: 0.01 });
    expect(r).not.toBeNull();
    expect(r!.speed).toBe(0.25);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("fade default: omitting fade_ms → 200", () => {
    const mc = createMotionController(realRegistry);
    const r = mc.resolve({ id: "drag" });
    expect(r!.fade_ms).toBe(200);
  });

  it("fade_ms:0 is valid and stays 0", () => {
    const mc = createMotionController(realRegistry);
    const r = mc.resolve({ id: "drag", fade_ms: 0 });
    expect(r!.fade_ms).toBe(0);
  });

  it("unregistered id returns null and calls warn once", () => {
    const warn = vi.fn();
    const mc = createMotionController(realRegistry, { warn });
    const r = mc.resolve({ id: "nope" });
    expect(r).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2  resolve() — variant selection
// ─────────────────────────────────────────────────────────────────────────────

describe("resolve() — variant selection (idle has 5 variants, policy 'random')", () => {
  it("rng:()=>0 → index 0 → /motions/idle_01.vrma", () => {
    const mc = createMotionController(variantRegistry, { rng: () => 0 });
    const r = mc.resolve({ id: "idle" });
    expect(r).not.toBeNull();
    expect(r!.vrma_path).toBe("/motions/idle_01.vrma");
  });

  it("rng:()=>0.999 → last index (4) → /motions/idle_05.vrma", () => {
    const mc = createMotionController(variantRegistry, { rng: () => 0.999 });
    const r = mc.resolve({ id: "idle" });
    expect(r).not.toBeNull();
    expect(r!.vrma_path).toBe("/motions/idle_05.vrma");
  });

  it("rng:()=>0.5 → index Math.floor(0.5*5)=2 → /motions/idle_03.vrma", () => {
    const mc = createMotionController(variantRegistry, { rng: () => 0.5 });
    const r = mc.resolve({ id: "idle" });
    expect(r).not.toBeNull();
    expect(r!.vrma_path).toBe("/motions/idle_03.vrma");
  });

  it("non-variant entry (drag) ignores rng — always /motions/drag.vrma", () => {
    // Use rng that would pick index 3 if applied, but drag has no variants
    const mc = createMotionController(variantRegistry, { rng: () => 0.999 });
    const r = mc.resolve({ id: "drag" });
    expect(r).not.toBeNull();
    expect(r!.vrma_path).toBe("/motions/drag.vrma");
  });

  it("sequential policy: successive resolve calls cycle index 0→1→2→0", () => {
    const mc = createMotionController(seqRegistry);
    const r0 = mc.resolve({ id: "seq_anim" });
    const r1 = mc.resolve({ id: "seq_anim" });
    const r2 = mc.resolve({ id: "seq_anim" });
    const r3 = mc.resolve({ id: "seq_anim" });
    expect(r0!.vrma_path).toBe("/motions/seq_a.vrma");
    expect(r1!.vrma_path).toBe("/motions/seq_b.vrma");
    expect(r2!.vrma_path).toBe("/motions/seq_c.vrma");
    expect(r3!.vrma_path).toBe("/motions/seq_a.vrma"); // wraps back to 0
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3  request() — interrupt policy
// ─────────────────────────────────────────────────────────────────────────────

describe("request() — interrupt policy", () => {
  it("no current motion → request({id:'happy'}) → {action:'play'}", () => {
    const mc = createMotionController(syntheticRegistry, { rng: () => 0 });
    const decision = mc.request({ id: "happy" });
    expect(decision.action).toBe("play");
  });

  it("incoming priority >= current priority → play (replace): idle→drag", () => {
    const mc = createMotionController(syntheticRegistry, { rng: () => 0 });
    // Commit idle as current
    const idleDecision = mc.request({ id: "idle" });
    mc.commit(idleDecision);
    // Request drag (priority 80) while idle (priority 0) is current
    const decision = mc.request({ id: "drag" });
    expect(decision.action).toBe("play");
  });

  it("incoming priority < current, incoming.interrupt_policy='ignore' → {action:'ignore'}", () => {
    // drag (p80) is current; low_ignore (p10, policy=ignore) comes in
    const mc = createMotionController(syntheticRegistry, { rng: () => 0 });
    const dragDecision = mc.request({ id: "drag" });
    mc.commit(dragDecision);
    const decision = mc.request({ id: "low_ignore" });
    expect(decision.action).toBe("ignore");
  });

  it("incoming priority < current, incoming.interrupt_policy='queue' → {action:'queue'}", () => {
    // drag (p80) is current; low_queue (p10, policy=queue) comes in
    const mc = createMotionController(syntheticRegistry, { rng: () => 0 });
    const dragDecision = mc.request({ id: "drag" });
    mc.commit(dragDecision);
    const decision = mc.request({ id: "low_queue" });
    expect(decision.action).toBe("queue");
  });

  it("incoming priority < current, incoming.interrupt_policy='replace' → {action:'play'}", () => {
    // drag (p80) is current; low_replace (p10, policy=replace) comes in
    const mc = createMotionController(syntheticRegistry, { rng: () => 0 });
    const dragDecision = mc.request({ id: "drag" });
    mc.commit(dragDecision);
    const decision = mc.request({ id: "low_replace" });
    expect(decision.action).toBe("play");
  });

  it("request(null) when current is NOT baseline → plays baseline idle", () => {
    const mc = createMotionController(syntheticRegistry, {
      rng: () => 0,
      baselineId: "idle",
    });
    const dragDecision = mc.request({ id: "drag" });
    mc.commit(dragDecision);
    const decision = mc.request(null);
    expect(decision.action).toBe("play");
    if (decision.action === "play") {
      expect(decision.motion.id).toBe("idle");
    }
  });

  it("request(null) when current IS already baseline idle → {action:'ignore'} (no restart)", () => {
    const mc = createMotionController(syntheticRegistry, {
      rng: () => 0,
      baselineId: "idle",
    });
    const idleDecision = mc.request({ id: "idle" });
    mc.commit(idleDecision);
    const decision = mc.request(null);
    expect(decision.action).toBe("ignore");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4  finish() — oneshot return
// ─────────────────────────────────────────────────────────────────────────────

describe("finish() — oneshot return to baseline", () => {
  it("finish oneshot → {action:'play'} returning previous ambient idle", () => {
    const mc = createMotionController(syntheticRegistry, {
      rng: () => 0,
      baselineId: "idle",
    });
    // Commit idle as the ambient baseline
    const idleDecision = mc.request({ id: "idle" });
    mc.commit(idleDecision);
    // Request+commit a oneshot (happy)
    const happyDecision = mc.request({ id: "happy" });
    mc.commit(happyDecision);
    // Oneshot finishes → should return to idle
    const afterFinish = mc.finish("happy");
    expect(afterFinish.action).toBe("play");
    if (afterFinish.action === "play") {
      expect(afterFinish.motion.id).toBe("idle");
    }
  });

  it("finish() of a motion that isn't current → {action:'ignore'}", () => {
    const mc = createMotionController(syntheticRegistry, { rng: () => 0 });
    const idleDecision = mc.request({ id: "idle" });
    mc.commit(idleDecision);
    // happy was never committed, so finishing it should be ignored
    const decision = mc.finish("happy");
    expect(decision.action).toBe("ignore");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6  cycle flag + idle re-randomization chain
// ─────────────────────────────────────────────────────────────────────────────

describe("resolve() — cycle flag", () => {
  it("idle (loop + 5 variants) → cycle true", () => {
    const mc = createMotionController(realRegistry);
    const r = mc.resolve({ id: "idle" });
    expect(r!.cycle).toBe(true);
  });

  it("drag (loop, no variants) → cycle false", () => {
    const mc = createMotionController(realRegistry);
    const r = mc.resolve({ id: "drag" });
    expect(r!.cycle).toBe(false);
  });

  it("happy (no loop) → cycle false", () => {
    const mc = createMotionController(realRegistry);
    const r = mc.resolve({ id: "happy" });
    expect(r!.cycle).toBe(false);
  });

  it("idle with explicit loop:false override → cycle false", () => {
    const mc = createMotionController(realRegistry);
    const r = mc.resolve({ id: "idle", loop: false });
    expect(r!.cycle).toBe(false);
  });
});

describe("resolve() — random avoids immediate variant repeat", () => {
  it("two successive idle resolves with a constant rng yield different variants", () => {
    // rng()=>0 would pick index 0 both times; the second must bump to index 1.
    const mc = createMotionController(variantRegistry, { rng: () => 0 });
    const r0 = mc.resolve({ id: "idle" });
    const r1 = mc.resolve({ id: "idle" });
    expect(r0!.vrma_path).toBe("/motions/idle_01.vrma");
    expect(r1!.vrma_path).not.toBe(r0!.vrma_path);
    expect(r1!.vrma_path).toBe("/motions/idle_02.vrma");
  });

  it("rng producing distinct indices is left unchanged (no bump)", () => {
    // 0 → index 0 (idle_01), 0.5 → index 2 (idle_03): already distinct, untouched.
    const seq = [0, 0.5];
    let i = 0;
    const rng = (): number => seq[i++ % seq.length]!;
    const mc = createMotionController(variantRegistry, { rng });
    const r0 = mc.resolve({ id: "idle" });
    const r1 = mc.resolve({ id: "idle" });
    expect(r0!.vrma_path).toBe("/motions/idle_01.vrma");
    expect(r1!.vrma_path).toBe("/motions/idle_03.vrma");
  });

  it("first pick with a fresh controller is never bumped (no prior 'last')", () => {
    const mc = createMotionController(variantRegistry, { rng: () => 0 });
    const r = mc.resolve({ id: "idle" });
    expect(r!.vrma_path).toBe("/motions/idle_01.vrma");
  });
});

describe("finish() — idle cycle re-randomizes", () => {
  it("finish('idle') returns a fresh idle variant differing from the played one", () => {
    // rng sequence: 0 → idle_01 (committed), 0 → would repeat so bumps to idle_02.
    const seq = [0, 0];
    let i = 0;
    const rng = (): number => seq[Math.min(i++, seq.length - 1)]!;
    const mc = createMotionController(realRegistry, { rng, baselineId: "idle" });

    const idle = mc.resolve({ id: "idle" });
    mc.commit({ action: "play", motion: idle! });
    expect(idle!.vrma_path).toBe("/motions/idle_01.vrma");

    const afterFinish = mc.finish("idle");
    expect(afterFinish.action).toBe("play");
    if (afterFinish.action === "play") {
      expect(afterFinish.motion.id).toBe("idle");
      expect(afterFinish.motion.cycle).toBe(true);
      expect([
        "/motions/idle_01.vrma",
        "/motions/idle_02.vrma",
        "/motions/idle_03.vrma",
        "/motions/idle_04.vrma",
        "/motions/idle_05.vrma",
      ]).toContain(afterFinish.motion.vrma_path);
      expect(afterFinish.motion.vrma_path).not.toBe(idle!.vrma_path);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7  window_sit (state, p55) — interaction with the existing state-machine
// ─────────────────────────────────────────────────────────────────────────────

describe("window_sit — exit and oneshot-return", () => {
  it("request(null) while window_sit is current → play baseline idle (exit → idle)", () => {
    const mc = createMotionController(sitRegistry, {
      rng: () => 0,
      baselineId: "idle",
    });
    const sit = mc.request({ id: "window_sit" });
    expect(sit.action).toBe("play");
    mc.commit(sit);
    expect(mc.current()!.id).toBe("window_sit");

    const decision = mc.request(null);
    expect(decision.action).toBe("play");
    if (decision.action === "play") {
      expect(decision.motion.id).toBe("idle");
    }
  });

  it("a p70 oneshot interrupts window_sit; finish(oneshot) returns window_sit via previousStable", () => {
    const mc = createMotionController(sitRegistry, {
      rng: () => 0,
      baselineId: "idle",
    });
    // Commit window_sit (state, p55) — saved as previousStable on commit.
    const sit = mc.request({ id: "window_sit" });
    mc.commit(sit);

    // p70 wave (>= 55) interrupts → play, committed as current.
    const wave = mc.request({ id: "wave" });
    expect(wave.action).toBe("play");
    mc.commit(wave);
    expect(mc.current()!.id).toBe("wave");

    // Oneshot finishes → returns to the saved stable state, window_sit.
    const afterFinish = mc.finish("wave");
    expect(afterFinish.action).toBe("play");
    if (afterFinish.action === "play") {
      expect(afterFinish.motion.id).toBe("window_sit");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5  commit() / current()
// ─────────────────────────────────────────────────────────────────────────────

describe("commit() / current()", () => {
  it("after commit({action:'play', motion}), current() returns that motion", () => {
    const mc = createMotionController(syntheticRegistry, { rng: () => 0 });
    const decision = mc.request({ id: "drag" });
    expect(decision.action).toBe("play");
    mc.commit(decision);
    const cur = mc.current();
    expect(cur).not.toBeNull();
    expect(cur!.id).toBe("drag");
  });

  it("queued decision: commit queue then finish current → queued motion plays (single-slot drain)", () => {
    // drag (p80) is current; low_queue (p10, queue) is queued.
    // When drag finishes, low_queue should become current.
    const mc = createMotionController(syntheticRegistry, { rng: () => 0 });

    // 1. Commit drag as current
    const dragDecision = mc.request({ id: "drag" });
    mc.commit(dragDecision);

    // 2. Queue low_queue (priority 10 < 80, policy=queue)
    const queueDecision = mc.request({ id: "low_queue" });
    expect(queueDecision.action).toBe("queue");
    mc.commit(queueDecision);

    // 3. drag finishes → drain: low_queue should play
    const afterFinish = mc.finish("drag");
    expect(afterFinish.action).toBe("play");
    if (afterFinish.action === "play") {
      expect(afterFinish.motion.id).toBe("low_queue");
    }
    mc.commit(afterFinish);
    expect(mc.current()!.id).toBe("low_queue");
  });
});
