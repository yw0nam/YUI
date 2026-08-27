/**
 * motion-controller.test.ts
 *
 * Encodes the contract that motion-controller.ts implements.
 *
 * Conventions:
 *  - Small synthetic registries for interrupt-policy edge cases.
 *  - Real configs/motions.json (loaded with readFileSync) for variant / idle cases.
 *  - `rng` is injected for deterministic variant selection.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { MotionRegistry } from "../contract";
import {
  createMotionController,
  needsRestartOnPoolChange,
  poolSelectionChanged,
  type ResolvedMotion,
  shouldRestartIdle,
} from "./motion-controller";
import { resolveBaselineFallback } from "./motion-fallback";

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
    variants: ["/motions/idle_01.vrma", "/motions/idle_02.vrma", "/motions/idle_03.vrma"],
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
// §1b  resolve() — entry-level fade_ms fallback
// ─────────────────────────────────────────────────────────────────────────────

describe("resolve() — entry-level fade_ms fallback", () => {
  /** Entry carries fade_ms:700; idle has none → exercises signal/entry/default precedence. */
  const fadeRegistry: MotionRegistry = {
    idle: {
      vrma_path: "/motions/idle_01.vrma",
      kind: "ambient",
      loop: true,
      priority: 0,
      interrupt_policy: "replace",
    },
    perch: {
      vrma_path: "/motions/sit_01.vrma",
      variants: ["/motions/sit_01.vrma", "/motions/sit_02.vrma"],
      variant_policy: "random",
      fade_ms: 700,
      kind: "state",
      loop: true,
      priority: 55,
      interrupt_policy: "replace",
    },
  };

  it("entry has fade_ms, signal omits it → resolved.fade_ms === entry.fade_ms", () => {
    const mc = createMotionController(fadeRegistry, { rng: () => 0 });
    const r = mc.resolve({ id: "perch" });
    expect(r!.fade_ms).toBe(700);
  });

  it("signal fade_ms overrides entry fade_ms", () => {
    const mc = createMotionController(fadeRegistry, { rng: () => 0 });
    const r = mc.resolve({ id: "perch", fade_ms: 120 });
    expect(r!.fade_ms).toBe(120);
  });

  it("neither signal nor entry fade_ms → DEFAULT_FADE_MS (200)", () => {
    const mc = createMotionController(fadeRegistry, { rng: () => 0 });
    const r = mc.resolve({ id: "idle" });
    expect(r!.fade_ms).toBe(200);
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

  it("single-variant loop entry with crossfade_loop:true → cycle true (opt-in self-loop)", () => {
    const xfadeRegistry: MotionRegistry = {
      thinking: {
        vrma_path: "/purchased_motions/thinking.vrma",
        crossfade_loop: true,
        kind: "state",
        loop: true,
        priority: 50,
        interrupt_policy: "ignore",
      },
    };
    const mc = createMotionController(xfadeRegistry);
    const r = mc.resolve({ id: "thinking" });
    expect(r!.cycle).toBe(true);
  });

  it("single-variant loop entry WITHOUT crossfade_loop → cycle false (control)", () => {
    const noFlagRegistry: MotionRegistry = {
      thinking: {
        vrma_path: "/purchased_motions/thinking.vrma",
        kind: "state",
        loop: true,
        priority: 50,
        interrupt_policy: "ignore",
      },
    };
    const mc = createMotionController(noFlagRegistry);
    const r = mc.resolve({ id: "thinking" });
    expect(r!.cycle).toBe(false);
  });

  it("multi-variant loop entry still resolves cycle true (no regression from the flag)", () => {
    const mc = createMotionController(realRegistry);
    const r = mc.resolve({ id: "idle" });
    expect(r!.cycle).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6b  pingpong → loop_reps
// ─────────────────────────────────────────────────────────────────────────────

describe("resolve() — pingpong loop_reps", () => {
  /** multi-variant pingpong (idle-like) with loop_cycles [1,3]. */
  const multiRegistry: MotionRegistry = {
    idle: {
      vrma_path: "/motions/idle_01.vrma",
      variants: ["/motions/idle_01.vrma", "/motions/idle_02.vrma", "/motions/idle_03.vrma"],
      variant_policy: "random",
      pingpong: true,
      loop_cycles: [1, 3],
      kind: "ambient",
      loop: true,
      priority: 0,
      interrupt_policy: "replace",
    },
  };
  /** single-variant pingpong (thinking-like) → continuous. */
  const singleRegistry: MotionRegistry = {
    thinking: {
      vrma_path: "/purchased_motions/thinking.vrma",
      pingpong: true,
      kind: "state",
      loop: true,
      priority: 50,
      interrupt_policy: "ignore",
    },
  };

  it("non-pingpong entry (drag) → pingpong false, loop_reps 0", () => {
    const mc = createMotionController(realRegistry);
    const r = mc.resolve({ id: "drag" });
    expect(r!.pingpong).toBe(false);
    expect(r!.loop_reps).toBe(0);
  });

  it("multi-variant pingpong → pingpong true, cycle true, loop_reps even", () => {
    const mc = createMotionController(multiRegistry, { rng: () => 0 });
    const r = mc.resolve({ id: "idle" });
    expect(r!.pingpong).toBe(true);
    expect(r!.cycle).toBe(true);
    expect(r!.loop_reps % 2).toBe(0);
  });

  it("multi-variant pingpong loop_reps within [2*lo, 2*hi] across rng stubs", () => {
    // rng feeds both variant pick AND the n draw; only the reps bound matters here.
    for (const stub of [0, 0.5, 0.99]) {
      const mc = createMotionController(multiRegistry, { rng: () => stub });
      const r = mc.resolve({ id: "idle" });
      expect(r!.loop_reps).toBeGreaterThanOrEqual(2); // 2*lo, lo=1
      expect(r!.loop_reps).toBeLessThanOrEqual(6); // 2*hi, hi=3
      expect(r!.loop_reps % 2).toBe(0);
    }
  });

  it("multi-variant pingpong: rng→0 picks lo (n=1) → loop_reps 2", () => {
    const mc = createMotionController(multiRegistry, { rng: () => 0 });
    const r = mc.resolve({ id: "idle" });
    expect(r!.loop_reps).toBe(2);
  });

  it("multi-variant pingpong: rng→0.99 picks hi (n=3) → loop_reps 6", () => {
    const mc = createMotionController(multiRegistry, { rng: () => 0.99 });
    const r = mc.resolve({ id: "idle" });
    expect(r!.loop_reps).toBe(6);
  });

  it("single-variant pingpong → pingpong true, cycle false, loop_reps Infinity", () => {
    const mc = createMotionController(singleRegistry);
    const r = mc.resolve({ id: "thinking" });
    expect(r!.pingpong).toBe(true);
    expect(r!.cycle).toBe(false);
    expect(r!.loop_reps).toBe(Infinity);
  });

  it("pingpong with loop:false override → pingpong false (guard), loop_reps 0", () => {
    const mc = createMotionController(singleRegistry);
    const r = mc.resolve({ id: "thinking", loop: false });
    expect(r!.pingpong).toBe(false);
    expect(r!.loop_reps).toBe(0);
  });

  it("drag interrupt re-resolves idle with a fresh count (no persistent counter)", () => {
    const dragRegistry: MotionRegistry = {
      ...multiRegistry,
      drag: {
        vrma_path: "/motions/drag.vrma",
        kind: "reactive",
        loop: true,
        priority: 80,
        interrupt_policy: "replace",
      },
    };
    // rng sequence threads variant pick + n draw across two idle resolves.
    const seq = [0, 0, 0.99, 0.99];
    let i = 0;
    const rng = (): number => seq[Math.min(i++, seq.length - 1)]!;
    const mc = createMotionController(dragRegistry, { rng, baselineId: "idle" });

    const idle = mc.request({ id: "idle" });
    expect(idle.action).toBe("play");
    mc.commit(idle);
    const repsA = idle.action === "play" ? idle.motion.loop_reps : -1;

    // drag interrupts immediately (p80 ≥ idle p0).
    const drag = mc.request({ id: "drag" });
    expect(drag.action).toBe("play");
    mc.commit(drag);

    // stale finish from the faded idle is ignored — no ghost swap.
    expect(mc.finish("idle").action).toBe("ignore");

    // return to idle later → fresh resolve, count NOT carried from before.
    const back = mc.request(null);
    expect(back.action).toBe("play");
    const repsB = back.action === "play" ? back.motion.loop_reps : -1;
    expect(repsA).toBe(2); // rng 0,0 → n=1
    expect(repsB).toBe(6); // rng 0.99,0.99 → n=3 (fresh, not repsA)
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
    // rng sequence: 0 → calm (committed), 0 → would repeat so bumps to idle_01.
    const seq = [0, 0];
    let i = 0;
    const rng = (): number => seq[Math.min(i++, seq.length - 1)]!;
    const mc = createMotionController(realRegistry, { rng, baselineId: "idle" });

    const idle = mc.resolve({ id: "idle" });
    mc.commit({ action: "play", motion: idle! });
    expect(idle!.vrma_path).toBe("/motions/calm.vrma");

    const afterFinish = mc.finish("idle");
    expect(afterFinish.action).toBe("play");
    if (afterFinish.action === "play") {
      expect(afterFinish.motion.id).toBe("idle");
      expect(afterFinish.motion.cycle).toBe(true);
      expect([
        "/motions/calm.vrma",
        "/motions/idle_01.vrma",
        "/motions/idle_04.vrma",
        "/motions/idle_12.vrma",
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

  it("a p70 oneshot over the real walk clip returns to idle, never back to walk", () => {
    const mc = createMotionController(realRegistry, { rng: () => 0, baselineId: "idle" });
    mc.commit(mc.request({ id: "walk" }));

    const happy = mc.request({ id: "happy" });
    expect(happy.action).toBe("play");
    mc.commit(happy);

    // The stroll is over the moment its clip is taken — a finishing oneshot must not
    // resume an in-place walk cycle on a character that is standing still.
    const afterFinish = mc.finish("happy");
    expect(afterFinish.action).toBe("play");
    if (afterFinish.action === "play") {
      expect(afterFinish.motion.id).toBe("idle");
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

// ─────────────────────────────────────────────────────────────────────────────
// §8  baseline() — single source of truth for the baseline id
// ─────────────────────────────────────────────────────────────────────────────

describe("baseline() — configured baseline id getter", () => {
  it("defaults to 'idle' when no baselineId is given", () => {
    const mc = createMotionController(syntheticRegistry, { rng: () => 0 });
    expect(mc.baseline()).toBe("idle");
  });

  it("returns the injected baselineId", () => {
    const mc = createMotionController(syntheticRegistry, {
      rng: () => 0,
      baselineId: "drag",
    });
    expect(mc.baseline()).toBe("drag");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9  variantFilter — the user's idle-motion selection, applied live
// ─────────────────────────────────────────────────────────────────────────────

describe("resolve() — variantFilter restricts the pool", () => {
  it("picks only from the filtered variants", () => {
    // rng always 0 → first entry of whatever pool resolve() sees.
    const mc = createMotionController(syntheticRegistry, {
      rng: () => 0,
      variantFilter: (id, variants) =>
        id === "idle" ? variants.filter((v) => v !== "/motions/idle_01.vrma") : variants,
    });
    expect(mc.resolve({ id: "idle" })!.vrma_path).toBe("/motions/idle_02.vrma");
  });

  it("leaves pools the filter does not target untouched", () => {
    const mc = createMotionController(realRegistry, {
      rng: () => 0,
      variantFilter: (id, variants) => (id === "idle" ? [variants[0]!] : variants),
    });
    expect(mc.resolve({ id: "dance" })!.vrma_path).toBe("/motions/dance_01.vrma");
  });

  it("re-reads the filter on every resolve — a store change applies live, no re-creation", () => {
    let enabled = ["/motions/idle_01.vrma", "/motions/idle_02.vrma", "/motions/idle_03.vrma"];
    const mc = createMotionController(syntheticRegistry, {
      rng: () => 0,
      variantFilter: (id, variants) =>
        id === "idle" ? variants.filter((v) => enabled.includes(v)) : variants,
    });
    expect(mc.resolve({ id: "idle" })!.vrma_path).toBe("/motions/idle_01.vrma");

    // The user turns idle_01 off while the controller keeps running.
    enabled = ["/motions/idle_02.vrma", "/motions/idle_03.vrma"];
    const picks = [0, 1, 2, 3].map(() => mc.resolve({ id: "idle" })!.vrma_path);
    expect(picks).not.toContain("/motions/idle_01.vrma");
  });

  it("chains the next cycle variant from the filtered pool on finish()", () => {
    let enabled = ["/motions/idle_01.vrma", "/motions/idle_02.vrma", "/motions/idle_03.vrma"];
    const mc = createMotionController(syntheticRegistry, {
      rng: () => 0,
      variantFilter: (id, variants) =>
        id === "idle" ? variants.filter((v) => enabled.includes(v)) : variants,
    });
    const first = mc.request({ id: "idle" });
    mc.commit(first);
    expect(mc.current()!.vrma_path).toBe("/motions/idle_01.vrma");

    // The playing variant is disabled — it finishes its cycle, then rotates out of the pool.
    enabled = ["/motions/idle_02.vrma", "/motions/idle_03.vrma"];
    const chained: string[] = [];
    for (let i = 0; i < 4; i++) {
      const next = mc.finish("idle");
      expect(next.action).toBe("play");
      if (next.action === "play") chained.push(next.motion.vrma_path);
      mc.commit(next);
    }
    expect(chained).not.toContain("/motions/idle_01.vrma");
  });

  it("falls back to the entry's vrma_path when the filter empties the pool", () => {
    // rng 0.9 would land on the last catalog variant if the filter were ignored.
    const mc = createMotionController(realRegistry, {
      rng: () => 0.9,
      variantFilter: () => [],
    });
    expect(mc.resolve({ id: "idle" })!.vrma_path).toBe("/motions/calm.vrma");
  });

  it("keeps the missing-clip baseline fallback working under a one-variant filter", () => {
    const mc = createMotionController(realRegistry, {
      rng: () => 0.9,
      variantFilter: (id, variants) =>
        id === "idle" ? variants.filter((v) => v === "/motions/calm.vrma") : variants,
    });
    const recovered = resolveBaselineFallback(mc, "thinking");
    expect(recovered?.id).toBe("idle");
    expect(recovered?.vrma_path).toBe("/motions/calm.vrma");
  });

  it("avoids an immediate repeat by path, not by index, across a pool change", () => {
    // 0.5 → index 1 of 3 (idle_02); after the filter drops idle_01, 0.3 → index 0, which is
    // idle_02 again. Index-based repeat avoidance misses that; path-based catches it.
    const rngValues = [0.5, 0.3];
    let call = 0;
    let enabled = ["/motions/idle_01.vrma", "/motions/idle_02.vrma", "/motions/idle_03.vrma"];
    const mc = createMotionController(syntheticRegistry, {
      rng: () => rngValues[call++] ?? 0,
      variantFilter: (id, variants) =>
        id === "idle" ? variants.filter((v) => enabled.includes(v)) : variants,
    });
    expect(mc.resolve({ id: "idle" })!.vrma_path).toBe("/motions/idle_02.vrma");

    enabled = ["/motions/idle_02.vrma", "/motions/idle_03.vrma"];
    expect(mc.resolve({ id: "idle" })!.vrma_path).toBe("/motions/idle_03.vrma");
  });

  it("keeps the sequential cursor inside a pool the filter has shrunk", () => {
    const registry: MotionRegistry = {
      seq: {
        vrma_path: "/motions/a.vrma",
        variants: ["/motions/a.vrma", "/motions/b.vrma", "/motions/c.vrma"],
        variant_policy: "sequential",
        kind: "ambient",
        loop: true,
        priority: 0,
        interrupt_policy: "replace",
      },
    };
    let enabled = ["/motions/a.vrma", "/motions/b.vrma", "/motions/c.vrma"];
    const mc = createMotionController(registry, {
      variantFilter: (_id, variants) => variants.filter((v) => enabled.includes(v)),
    });
    expect(mc.resolve({ id: "seq" })!.vrma_path).toBe("/motions/a.vrma");
    expect(mc.resolve({ id: "seq" })!.vrma_path).toBe("/motions/b.vrma");

    // Cursor now sits at 2, past the end of the shrunken pool.
    enabled = ["/motions/a.vrma"];
    expect(mc.resolve({ id: "seq" })!.vrma_path).toBe("/motions/a.vrma");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10  invalidatePool() — the cached return target must not outlive a pool change
// ─────────────────────────────────────────────────────────────────────────────

describe("invalidatePool()", () => {
  /** Plays idle from a baseline-only pool, then interleaves a oneshot over it. */
  function playIdleThenOneshot(enabled: () => readonly string[]) {
    const mc = createMotionController(realRegistry, {
      rng: () => 0.9,
      variantFilter: (id, variants) =>
        id === "idle" ? variants.filter((v) => enabled().includes(v)) : variants,
    });
    mc.commit(mc.request({ id: "idle" }));
    expect(mc.current()!.vrma_path).toBe("/motions/calm.vrma");
    expect(mc.current()!.cycle).toBe(false); // pool of one → loops, never finishes
    mc.commit(mc.request({ id: "happy" }));
    expect(mc.current()!.id).toBe("happy");
    return mc;
  }

  it("re-resolves the pool after an interleaved oneshot instead of replaying a stale resolution", () => {
    let enabled: readonly string[] = ["/motions/calm.vrma"];
    const mc = playIdleThenOneshot(() => enabled);

    // The user widens the pool while the oneshot covers the ambient motion. `idle` is not the
    // current motion, so nothing restarts — the change has to survive in previousStable.
    enabled = ["/motions/calm.vrma", "/motions/idle_04.vrma"];
    mc.invalidatePool("idle");

    const back = mc.finish("happy");
    expect(back.action).toBe("play");
    if (back.action !== "play") return;
    expect(back.motion.id).toBe("idle");
    expect(back.motion.vrma_path).toBe("/motions/idle_04.vrma");
    // Two variants again, so the cycle resumes and later changes ride the rotation.
    expect(back.motion.cycle).toBe(true);
  });

  it("leaves a different pool's return target untouched — the same pose resumes", () => {
    const mc = createMotionController(realRegistry, { rng: () => 0.9 });
    mc.commit(mc.request({ id: "window_sit" }));
    const perch = mc.current()!;
    mc.commit(mc.request({ id: "happy" }));

    mc.invalidatePool("idle");

    const back = mc.finish("happy");
    expect(back.action).toBe("play");
    if (back.action !== "play") return;
    // Identity, not just id — the perch resumes its exact resolved variant, un-re-resolved.
    expect(back.motion).toBe(perch);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §11  needsRestartOnPoolChange — a non-cycling ambient never re-resolves on its own
// ─────────────────────────────────────────────────────────────────────────────

describe("needsRestartOnPoolChange()", () => {
  const ambient = (over: Partial<ResolvedMotion>): ResolvedMotion => ({
    id: "idle",
    vrma_path: "/motions/calm.vrma",
    loop: true,
    cycle: true,
    pingpong: true,
    loop_reps: 2,
    speed: 1,
    fade_ms: 200,
    kind: "ambient",
    priority: 0,
    interrupt_policy: "replace",
    ...over,
  });

  it("is true when the pool motion is playing without a cycle — no finish event will ever land", () => {
    expect(needsRestartOnPoolChange(ambient({ cycle: false }), "idle")).toBe(true);
  });

  it("is false while the pool is cycling — the playing variant finishes and re-resolves", () => {
    expect(needsRestartOnPoolChange(ambient({ cycle: true }), "idle")).toBe(false);
  });

  it("is false when another motion is playing", () => {
    expect(needsRestartOnPoolChange(ambient({ id: "dance", cycle: false }), "idle")).toBe(false);
  });

  it("is false when nothing is playing", () => {
    expect(needsRestartOnPoolChange(null, "idle")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §12  poolSelectionChanged / shouldRestartIdle — the renderer's setIdleVariants decision
// ─────────────────────────────────────────────────────────────────────────────

describe("poolSelectionChanged()", () => {
  it("is true on the first selection — nothing was applied before", () => {
    expect(poolSelectionChanged(null, ["/motions/calm.vrma"])).toBe(true);
  });

  it("is false for the same paths in the same order", () => {
    const paths = ["/motions/calm.vrma", "/motions/idle_04.vrma"];
    expect(poolSelectionChanged(paths, [...paths])).toBe(false);
  });

  it("is true when a variant is added or removed", () => {
    expect(poolSelectionChanged(["/motions/calm.vrma"], [])).toBe(true);
    expect(
      poolSelectionChanged(["/motions/calm.vrma"], ["/motions/calm.vrma", "/motions/idle_04.vrma"]),
    ).toBe(true);
  });

  it("is true when a variant is swapped at the same length", () => {
    expect(poolSelectionChanged(["/motions/idle_01.vrma"], ["/motions/idle_04.vrma"])).toBe(true);
  });
});

describe("shouldRestartIdle()", () => {
  const playing = (over: Partial<ResolvedMotion>): ResolvedMotion => ({
    id: "idle",
    vrma_path: "/motions/calm.vrma",
    loop: true,
    cycle: false,
    pingpong: true,
    loop_reps: Number.POSITIVE_INFINITY,
    speed: 1,
    fade_ms: 200,
    kind: "ambient",
    priority: 0,
    interrupt_policy: "replace",
    ...over,
  });
  const before = ["/motions/calm.vrma"];
  const after = ["/motions/calm.vrma", "/motions/idle_04.vrma"];

  it("restarts a stuck pool-of-one when the selection changed", () => {
    expect(shouldRestartIdle(before, after, playing({}), "idle")).toBe(true);
  });

  it("does not restart when the selection is unchanged", () => {
    expect(shouldRestartIdle(before, [...before], playing({}), "idle")).toBe(false);
  });

  it("does not restart a cycling pool — the rotation picks the change up", () => {
    expect(shouldRestartIdle(before, after, playing({ cycle: true }), "idle")).toBe(false);
  });

  it("does not restart while another motion covers the pool", () => {
    expect(shouldRestartIdle(before, after, playing({ id: "happy" }), "idle")).toBe(false);
  });

  it("does not restart when nothing is playing yet", () => {
    expect(shouldRestartIdle(before, after, null, "idle")).toBe(false);
  });
});

describe("the restart shouldRestartIdle asks for — an explicit baseline request", () => {
  /** A pool narrowed to the baseline alone: resolves `cycle: false`, so it loops without finishing. */
  function stuckOnBaseline(enabled: () => readonly string[]) {
    const mc = createMotionController(realRegistry, {
      rng: () => 0.9,
      variantFilter: (id, variants) =>
        id === "idle" ? variants.filter((v) => enabled().includes(v)) : variants,
    });
    mc.commit(mc.request({ id: "idle" }));
    expect(mc.current()!.vrma_path).toBe("/motions/calm.vrma");
    expect(mc.current()!.cycle).toBe(false);
    return mc;
  }

  it("replays the widened pool for request({id:'idle'}) — what playIdleBaseline() issues", () => {
    let enabled: readonly string[] = ["/motions/calm.vrma"];
    const mc = stuckOnBaseline(() => enabled);
    enabled = ["/motions/calm.vrma", "/motions/idle_04.vrma"];

    // Baseline over baseline is not a no-op: equal priority takes the `>=` branch and re-resolves.
    const decision = mc.request({ id: "idle" });
    expect(decision.action).toBe("play");
    if (decision.action !== "play") return;
    expect(decision.motion.vrma_path).toBe("/motions/idle_04.vrma");
    expect(decision.motion.cycle).toBe(true); // two variants again — later changes ride the rotation
  });

  it("ignores request(null) at the baseline — restarting through null would lose the change", () => {
    let enabled: readonly string[] = ["/motions/calm.vrma"];
    const mc = stuckOnBaseline(() => enabled);
    enabled = ["/motions/calm.vrma", "/motions/idle_04.vrma"];

    expect(mc.request(null).action).toBe("ignore");
  });
});
