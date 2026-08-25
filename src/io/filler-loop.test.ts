/**
 * filler-loop.test.ts — bounded, event-aware TTFT filler scheduler.
 *
 * Pins the contract for src/io/filler-loop.ts:
 *   createFillerLoop(deps): FillerLoop
 *
 * All timer seams are injected. random seam is deterministic (index-0 picks throughout, since
 * the shuffle bag's first shuffled draw with random()=0 lands on the pool's own order).
 * No renderer, no pipeline knowledge — pure scheduling logic.
 */

import { describe, expect, it, vi } from "vitest";
import type { FillerPool } from "../config/load";
import { createFillerLoop, type FillerLoopDeps } from "./filler-loop";

// ─────────────────────────────────────────────────────────────────────────────
// Fake timer helpers — supports advancing by an amount and firing everything due.
// ─────────────────────────────────────────────────────────────────────────────

function makeTimers() {
  let id = 0;
  let now = 0;
  const pending = new Map<number, { fn: () => void; at: number }>();

  const setTimeout = (fn: () => void, ms: number): number => {
    const tid = ++id;
    pending.set(tid, { fn, at: now + ms });
    return tid;
  };
  const clearTimeout = (tid: number): void => {
    pending.delete(tid);
  };
  // Advances the clock and fires every timer whose deadline has now passed, in deadline order.
  const advance = (ms: number): void => {
    now += ms;
    while (true) {
      let next: [number, { fn: () => void; at: number }] | undefined;
      for (const entry of pending) {
        if (entry[1].at <= now && (!next || entry[1].at < next[1].at)) next = entry;
      }
      if (!next) return;
      pending.delete(next[0]);
      next[1].fn();
    }
  };
  const hasPending = (): boolean => pending.size > 0;

  return { setTimeout, clearTimeout, advance, hasPending };
}

function pool(overrides: Partial<FillerPool> = {}): FillerPool {
  return {
    first: ["first-a"],
    repeat: ["repeat-x"],
    long_wait: ["long-wait-a"],
    tool: {},
    timeout: [],
    unreachable: [],
    ...overrides,
  };
}

function makeDeps(overrides: Partial<FillerLoopDeps> = {}): FillerLoopDeps & {
  spoken: string[];
  timers: ReturnType<typeof makeTimers>;
} {
  const spoken: string[] = [];
  const timers = makeTimers();
  return {
    speak: (text) => spoken.push(text),
    getPools: () => pool(),
    getTiming: () => ({ gapMs: 1000, jitterMs: 0, maxRepeats: 3, gapGrowth: 2, longWaitMs: 1000 }),
    isCached: () => true,
    setTimeout: timers.setTimeout as typeof globalThis.setTimeout,
    clearTimeout: timers.clearTimeout as typeof globalThis.clearTimeout,
    random: () => 0,
    spoken,
    timers,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The full bounded schedule
// ─────────────────────────────────────────────────────────────────────────────

describe("createFillerLoop — the full waiting schedule", () => {
  it("speaks first, repeat×3 at t≈7/21/49s, long_wait 40s after the last repeat (t≈89s) for gap 7000/jitter 0/growth 2/max 3/long_wait_ms 40000, then nothing follows", () => {
    const deps = makeDeps({
      getPools: () =>
        pool({ first: ["first-a"], repeat: ["repeat-x"], long_wait: ["long-wait-a"] }),
      getTiming: () => ({
        gapMs: 7000,
        jitterMs: 0,
        maxRepeats: 3,
        gapGrowth: 2,
        longWaitMs: 40000,
      }),
    });
    const loop = createFillerLoop(deps);

    loop.start();
    expect(deps.spoken).toEqual(["first-a"]);

    loop.onUtteranceDone(); // schedules repeat #0 at gap*growth^0 = 7000ms
    deps.timers.advance(7000);
    expect(deps.spoken).toEqual(["first-a", "repeat-x"]);

    loop.onUtteranceDone(); // schedules repeat #1 at gap*growth^1 = 14000ms (t=21s)
    deps.timers.advance(14000);
    expect(deps.spoken).toEqual(["first-a", "repeat-x", "repeat-x"]);

    loop.onUtteranceDone(); // schedules repeat #2 at gap*growth^2 = 28000ms (t=49s)
    deps.timers.advance(28000);
    expect(deps.spoken).toEqual(["first-a", "repeat-x", "repeat-x", "repeat-x"]);

    loop.onUtteranceDone(); // repeats exhausted (3 == max) — schedules long_wait long_wait_ms=40000ms after this (t=89s)
    deps.timers.advance(40000);
    expect(deps.spoken).toEqual(["first-a", "repeat-x", "repeat-x", "repeat-x", "long-wait-a"]);

    // Nothing follows: the long_wait utterance's own onUtteranceDone schedules nothing further,
    // and the timeline stays quiet for another minute.
    loop.onUtteranceDone();
    deps.timers.advance(60_000);
    expect(deps.spoken).toEqual(["first-a", "repeat-x", "repeat-x", "repeat-x", "long-wait-a"]);
    expect(deps.timers.hasPending()).toBe(false);
  });

  it("after tool activity (no repeats), long_wait fires long_wait_ms after the last activity", () => {
    const deps = makeDeps({
      getPools: () => pool({ tool: { terminal: ["ack"] }, long_wait: ["long-wait-a"] }),
      getTiming: () => ({
        gapMs: 7000,
        jitterMs: 0,
        maxRepeats: 3,
        gapGrowth: 2,
        longWaitMs: 40000,
      }),
    });
    const loop = createFillerLoop(deps);
    loop.start();
    loop.onToolRunning("terminal"); // arms long_wait 40s from now

    deps.timers.advance(39999);
    expect(deps.spoken).not.toContain("long-wait-a");
    deps.timers.advance(1);
    expect(deps.spoken).toContain("long-wait-a");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool events
// ─────────────────────────────────────────────────────────────────────────────

describe("createFillerLoop — onToolRunning()", () => {
  it("speaks a tool's own phrase once even if that tool_id runs three times in the turn", () => {
    const deps = makeDeps({
      getPools: () => pool({ tool: { terminal: ["running the terminal"] } }),
    });
    const loop = createFillerLoop(deps);
    loop.start();
    deps.spoken.length = 0; // drop the first-phrase speak, focus on tool behaviour

    loop.onToolRunning("terminal");
    loop.onToolRunning("terminal");
    loop.onToolRunning("terminal");

    expect(deps.spoken).toEqual(["running the terminal"]);
  });

  it("falls back to a shared _default pool for unknown tool ids, budgeted to the pool's size, then stays silent", () => {
    const deps = makeDeps({
      getPools: () => pool({ tool: { _default: ["checking…", "looking into it…"] } }),
    });
    const loop = createFillerLoop(deps);
    loop.start();
    deps.spoken.length = 0;

    loop.onToolRunning("mystery_tool_a");
    loop.onToolRunning("mystery_tool_b");
    loop.onToolRunning("mystery_tool_c");

    // Draw order depends on the shuffle bag's internals — only the multiset (each phrase once,
    // nothing after the budget is spent) is part of the contract.
    expect(deps.spoken).toHaveLength(2);
    expect([...deps.spoken].sort()).toEqual(["checking…", "looking into it…"].sort());
  });

  it("cancels a pending repeat timer on the first tool event and re-arms long_wait instead", () => {
    const deps = makeDeps();
    const loop = createFillerLoop(deps);
    loop.start();
    loop.onUtteranceDone(); // arms a repeat timer
    expect(deps.timers.hasPending()).toBe(true);

    loop.onToolRunning("terminal");
    // A repeat could never legally fire again this turn — advancing far past the old repeat's
    // due time must not produce a second "repeat-x" speak, only whatever the tool/long_wait path speaks.
    const before = deps.spoken.length;
    deps.timers.advance(500); // well short of any repeat/long_wait delay
    expect(deps.spoken.length).toBe(before);
    expect(deps.timers.hasPending()).toBe(true); // long_wait now pending
  });

  it("does nothing when the loop is inactive", () => {
    const deps = makeDeps();
    const loop = createFillerLoop(deps);
    loop.onToolRunning("terminal");
    expect(deps.spoken).toEqual([]);
    expect(deps.timers.hasPending()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// onActivity() — postpones a pending long_wait
// ─────────────────────────────────────────────────────────────────────────────

describe("createFillerLoop — onActivity()", () => {
  it("restarts a pending long_wait timer from now, so it never fires while activity keeps arriving", () => {
    const deps = makeDeps({
      getTiming: () => ({
        gapMs: 1000,
        jitterMs: 0,
        maxRepeats: 0,
        gapGrowth: 1,
        longWaitMs: 1000,
      }),
    });
    const loop = createFillerLoop(deps);
    loop.start();
    loop.onUtteranceDone(); // maxRepeats=0 → schedules long_wait immediately (delay = long_wait_ms = 1000)
    expect(deps.timers.hasPending()).toBe(true);

    for (let i = 0; i < 5; i++) {
      deps.timers.advance(900); // short of the 1000ms delay
      loop.onActivity(); // restarts the long_wait timer from now
    }
    expect(deps.spoken).not.toContain("long-wait-a");

    // Once activity stops arriving, the timer finally elapses.
    deps.timers.advance(1000);
    expect(deps.spoken).toContain("long-wait-a");
  });

  it("is a no-op when no long_wait timer is pending", () => {
    const deps = makeDeps();
    const loop = createFillerLoop(deps);
    loop.start(); // no timer pending yet — waiting on onUtteranceDone
    expect(deps.timers.hasPending()).toBe(false);
    loop.onActivity();
    expect(deps.timers.hasPending()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// start() behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe("createFillerLoop — start()", () => {
  it("speaks a first phrase immediately when the first pool is non-empty", () => {
    const deps = makeDeps();
    const loop = createFillerLoop(deps);
    loop.start();
    expect(deps.spoken).toEqual(["first-a"]);
    expect(deps.timers.hasPending()).toBe(false);
  });

  it("schedules the first repeat immediately when first is empty but repeat is non-empty", () => {
    const deps = makeDeps({ getPools: () => pool({ first: [], repeat: ["repeat-x"] }) });
    const loop = createFillerLoop(deps);
    loop.start();
    expect(deps.spoken).toEqual([]);
    expect(deps.timers.hasPending()).toBe(true);
  });

  it("does nothing when first and repeat are both empty", () => {
    const deps = makeDeps({ getPools: () => pool({ first: [], repeat: [] }) });
    const loop = createFillerLoop(deps);
    loop.start();
    expect(deps.spoken).toEqual([]);
    expect(deps.timers.hasPending()).toBe(false);
  });

  it("resets per-turn state (repeatsSpoken, spoken tool ids, degraded) but not the shuffle bags", () => {
    const deps = makeDeps({
      getPools: () => pool({ tool: { terminal: ["ack"] } }),
      isCached: () => false,
    });
    const loop = createFillerLoop(deps);
    loop.start();
    loop.onToolRunning("terminal"); // marks "terminal" spoken this turn
    loop.onSynthFailure(); // degrades

    loop.stop();
    loop.start(); // new turn: degraded clears, "terminal" can speak again
    deps.spoken.length = 0;
    loop.onToolRunning("terminal");
    expect(deps.spoken).toEqual(["ack"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// onSynthFailure() — degraded mode
// ─────────────────────────────────────────────────────────────────────────────

describe("createFillerLoop — onSynthFailure() degraded mode", () => {
  it("re-arms the timer it cancelled instead of leaving nothing pending", () => {
    const deps = makeDeps({ isCached: () => false });
    const loop = createFillerLoop(deps);
    loop.start();
    loop.onUtteranceDone(); // arms repeat #0
    expect(deps.timers.hasPending()).toBe(true);

    loop.onSynthFailure(); // degrades — the cancelled repeat timer must come back, not vanish
    expect(deps.timers.hasPending()).toBe(true);
  });

  it("in phase tool, re-arms long_wait instead of leaving nothing pending", () => {
    const deps = makeDeps({ getPools: () => pool({ tool: { terminal: ["ack"] } }) });
    const loop = createFillerLoop(deps);
    loop.start();
    loop.onToolRunning("terminal"); // phase=tool, long_wait armed
    expect(deps.timers.hasPending()).toBe(true);

    loop.onSynthFailure(); // e.g. the tool ack's own synth failed — long_wait must still be armed
    expect(deps.timers.hasPending()).toBe(true);
  });

  it("a cold degraded run (nothing cached) self-drives every repeat straight through to long_wait — no hand-called onUtteranceDone after a skip", () => {
    const deps = makeDeps({
      getTiming: () => ({
        gapMs: 1000,
        jitterMs: 0,
        maxRepeats: 2,
        gapGrowth: 1,
        longWaitMs: 1000,
      }),
      isCached: () => false,
    });
    const loop = createFillerLoop(deps);
    loop.start(); // speaks "first-a" — not degraded yet, so this one legitimately plays
    loop.onSynthFailure(); // degrades — nothing pending yet, no rearm needed
    loop.onUtteranceDone(); // the real playback-driven call for "first-a" finishing — arms repeat #0

    // From here on nothing calls onUtteranceDone by hand: every uncached phrase is skipped, and
    // the loop must drive itself forward through the timer callbacks alone. A `hasPending()` check
    // after every single advance is what actually distinguishes "self-drove to the next step" from
    // "silently died" — the end state alone (nothing spoken, nothing pending) looks the same either way.
    deps.timers.advance(1000); // repeat #0 fires, skipped
    expect(deps.timers.hasPending()).toBe(true); // self-advanced to repeat #1 — did not just die here

    deps.timers.advance(1000); // repeat #1 fires, skipped
    expect(deps.timers.hasPending()).toBe(true); // self-advanced to long_wait

    deps.timers.advance(1000); // long_wait fires, skipped too (nothing cached)
    expect(deps.timers.hasPending()).toBe(false); // nothing follows long_wait, by design

    expect(deps.spoken).toEqual(["first-a"]);
  });

  it("warns once on entering degraded mode, not per skipped cycle", () => {
    const warn = vi.fn();
    const deps = makeDeps({
      isCached: () => false,
      logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() },
    });
    const loop = createFillerLoop(deps);
    loop.start();
    loop.onSynthFailure();
    loop.onSynthFailure();
    loop.onSynthFailure();
    expect(warn).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// stop()
// ─────────────────────────────────────────────────────────────────────────────

describe("createFillerLoop — stop()", () => {
  it("cancels a pending timer", () => {
    const deps = makeDeps({ getPools: () => pool({ first: [], repeat: ["repeat-x"] }) });
    const loop = createFillerLoop(deps);
    loop.start();
    expect(deps.timers.hasPending()).toBe(true);
    loop.stop();
    expect(deps.timers.hasPending()).toBe(false);
  });

  it("is idempotent", () => {
    const deps = makeDeps();
    const loop = createFillerLoop(deps);
    loop.start();
    loop.stop();
    expect(() => loop.stop()).not.toThrow();
  });

  it("makes onUtteranceDone/onToolRunning/onActivity no-ops after stop", () => {
    const deps = makeDeps();
    const loop = createFillerLoop(deps);
    loop.start();
    loop.stop();
    const before = deps.spoken.length;
    loop.onUtteranceDone();
    loop.onToolRunning("terminal");
    loop.onActivity();
    deps.timers.advance(100_000);
    expect(deps.spoken.length).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Live getPools/getTiming reads (hot-reload seam)
// ─────────────────────────────────────────────────────────────────────────────

describe("createFillerLoop — live getPools/getTiming reads", () => {
  it("uses the pool and timing returned at call time, not a snapshot from start()", () => {
    let useAlt = false;
    const deps = makeDeps({
      getPools: () => (useAlt ? pool({ repeat: ["alt-repeat"] }) : pool()),
    });
    const loop = createFillerLoop(deps);
    loop.start();
    expect(deps.spoken).toEqual(["first-a"]);

    useAlt = true;
    loop.onUtteranceDone();
    deps.timers.advance(1000);
    expect(deps.spoken).toEqual(["first-a", "alt-repeat"]);
  });
});
