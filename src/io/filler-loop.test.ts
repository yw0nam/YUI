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

  it("after tool activity (no repeats), long_wait fires long_wait_ms after the tool phrase is spoken", () => {
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
    loop.onUtteranceDone();
    loop.onToolRunning("terminal"); // arms the tool-gap timer (TOOL_GAP_MS=700ms)
    deps.timers.advance(700); // tool phrase speaks, then long_wait is armed 40s from now
    expect(deps.spoken).toContain("ack");

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

    loop.onUtteranceDone();
    loop.onToolRunning("terminal");
    loop.onToolRunning("terminal");
    loop.onToolRunning("terminal");
    deps.timers.advance(700);

    expect(deps.spoken).toEqual(["running the terminal"]);
  });

  it("falls back to a shared _default pool for unknown tool ids, budgeted to the pool's size, then stays silent", () => {
    const deps = makeDeps({
      getPools: () => pool({ tool: { _default: ["checking…", "looking into it…"] } }),
    });
    const loop = createFillerLoop(deps);
    loop.start();
    deps.spoken.length = 0;

    // Each tool must clear the gap before the next one starts — pendingToolId only holds one id
    // at a time, so three tools in flight together would drop all but the last.
    loop.onUtteranceDone();
    loop.onToolRunning("mystery_tool_a");
    deps.timers.advance(700);

    loop.onUtteranceDone();
    loop.onToolRunning("mystery_tool_b");
    deps.timers.advance(700);

    loop.onUtteranceDone();
    loop.onToolRunning("mystery_tool_c");
    deps.timers.advance(700);

    // Draw order depends on the shuffle bag's internals — only the multiset (each phrase once,
    // nothing after the budget is spent) is part of the contract.
    expect(deps.spoken).toHaveLength(2);
    expect([...deps.spoken].sort()).toEqual(["checking…", "looking into it…"].sort());
  });

  it("cancels a pending repeat timer on the first tool event and re-arms a tool-gap timer instead", () => {
    const deps = makeDeps();
    const loop = createFillerLoop(deps);
    loop.start();
    loop.onUtteranceDone(); // arms a repeat timer
    expect(deps.timers.hasPending()).toBe(true);

    loop.onToolRunning("terminal");
    // A repeat could never legally fire again this turn — advancing far past the old repeat's
    // due time must not produce a second "repeat-x" speak, only whatever the tool-gap path speaks.
    const before = deps.spoken.length;
    deps.timers.advance(500); // well short of TOOL_GAP_MS (700ms)
    expect(deps.spoken.length).toBe(before);
    expect(deps.timers.hasPending()).toBe(true); // tool-gap timer now pending
  });

  it("does nothing when the loop is inactive", () => {
    const deps = makeDeps();
    const loop = createFillerLoop(deps);
    loop.onToolRunning("terminal");
    expect(deps.spoken).toEqual([]);
    expect(deps.timers.hasPending()).toBe(false);
  });

  it("waits for the in-flight utterance, then TOOL_GAP_MS, before speaking a tool phrase", () => {
    const deps = makeDeps({
      getPools: () => pool({ tool: { web_search: ["searching"] } }),
    });
    const loop = createFillerLoop(deps);

    loop.start(); // speaks "first-a"
    loop.onToolRunning("web_search");
    expect(deps.spoken).toEqual(["first-a"]); // still in flight, not yet spoken

    deps.timers.advance(700);
    expect(deps.spoken).toEqual(["first-a"]); // the previous utterance hasn't ended

    loop.onUtteranceDone();
    deps.timers.advance(699);
    expect(deps.spoken).toEqual(["first-a"]);
    deps.timers.advance(1);
    expect(deps.spoken).toEqual(["first-a", "searching"]);
  });

  it("speaks after TOOL_GAP_MS when nothing is in flight", () => {
    const deps = makeDeps({
      getPools: () => pool({ tool: { web_search: ["searching"] } }),
    });
    const loop = createFillerLoop(deps);

    loop.start();
    loop.onUtteranceDone();
    loop.onToolRunning("web_search");
    expect(deps.spoken).toEqual(["first-a"]); // nothing yet

    deps.timers.advance(700);
    expect(deps.spoken).toEqual(["first-a", "searching"]);
  });

  it("only the latest of several tools that started before the phrase was spoken is voiced", () => {
    const deps = makeDeps({
      getPools: () => pool({ tool: { web_search: ["searching"], terminal: ["running-terminal"] } }),
    });
    const loop = createFillerLoop(deps);

    loop.start(); // in flight
    loop.onToolRunning("web_search");
    loop.onToolRunning("terminal");
    loop.onUtteranceDone();
    deps.timers.advance(700);

    expect(deps.spoken).not.toContain("searching");
    expect(deps.spoken[deps.spoken.length - 1]).toBe("running-terminal");
  });

  it("stop() before the gap elapses drops the pending tool phrase", () => {
    const deps = makeDeps({
      getPools: () => pool({ tool: { web_search: ["searching"] } }),
    });
    const loop = createFillerLoop(deps);

    loop.start();
    loop.onUtteranceDone();
    loop.onToolRunning("web_search");
    loop.stop();
    deps.timers.advance(5000);

    expect(deps.spoken).not.toContain("searching");
    expect(deps.timers.hasPending()).toBe(false);
  });

  it("still speaks the pending phrase when the tool's own done arrives during the gap", () => {
    const deps = makeDeps({
      getPools: () => pool({ tool: { web_search: ["searching"] } }),
    });
    const loop = createFillerLoop(deps);

    loop.start();
    loop.onUtteranceDone();
    loop.onToolRunning("web_search");
    loop.onActivity(); // tool_status done — the phrase is still thinking-window filler
    deps.timers.advance(700);

    expect(deps.spoken).toEqual(["first-a", "searching"]);
  });

  it("keeps scheduling when speak() completes playback synchronously (a phrase that submits no audio)", () => {
    // An emoji-only phrase reaches pipeline.end() with nothing submitted, so onPlaybackEnd — and
    // thus onUtteranceDone — fires inside the speak() call itself.
    const deps = makeDeps({
      getPools: () => pool({ first: ["🙂"], tool: { web_search: ["searching"] } }),
    });
    const loop = createFillerLoop({
      ...deps,
      speak: (text) => {
        deps.spoken.push(text);
        loop.onUtteranceDone();
      },
    });

    loop.start(); // "🙂" completes re-entrantly; nothing is in flight afterwards
    loop.onToolRunning("web_search");
    deps.timers.advance(700);

    expect(deps.spoken).toEqual(["🙂", "searching"]);
  });

  it("three unknown tools starting while one utterance plays yield a single _default phrase", () => {
    const deps = makeDeps({
      getPools: () => pool({ tool: { _default: ["checking…", "looking into it…"] } }),
    });
    const loop = createFillerLoop(deps);
    loop.start(); // in flight
    loop.onToolRunning("mystery_tool_a");
    loop.onToolRunning("mystery_tool_b");
    loop.onToolRunning("mystery_tool_c");
    loop.onUtteranceDone();
    deps.timers.advance(700);

    expect(deps.spoken.length).toBe(2); // first phrase + one _default phrase, not three
    expect(["checking…", "looking into it…"]).toContain(deps.spoken[1]);
  });

  it("re-arms long_wait after the tool phrase", () => {
    const deps = makeDeps({
      getPools: () => pool({ tool: { web_search: ["searching"] }, long_wait: ["long-wait-a"] }),
    });
    const loop = createFillerLoop(deps);

    loop.start();
    loop.onUtteranceDone();
    loop.onToolRunning("web_search");
    deps.timers.advance(700); // tool phrase speaks, then long_wait is armed
    expect(deps.spoken).toContain("searching");

    deps.timers.advance(1000); // default longWaitMs from makeDeps()
    expect(deps.spoken).toContain("long-wait-a");
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

  it("does nothing when first, repeat, and long_wait are all empty", () => {
    const deps = makeDeps({
      getPools: () => pool({ first: [], repeat: [], long_wait: [] }),
    });
    const loop = createFillerLoop(deps);
    loop.start();
    expect(deps.spoken).toEqual([]);
    expect(deps.timers.hasPending()).toBe(false);
  });

  it("arms a timer (through empty repeats to long_wait) when only long_wait is non-empty — a long_wait-only pool must not open a silent, unending thinking window", () => {
    const deps = makeDeps({
      getPools: () => pool({ first: [], repeat: [], long_wait: ["long-wait-a"] }),
      getTiming: () => ({
        gapMs: 1000,
        jitterMs: 0,
        maxRepeats: 2,
        gapGrowth: 1,
        longWaitMs: 1000,
      }),
    });
    const loop = createFillerLoop(deps);
    loop.start();
    expect(deps.spoken).toEqual([]);
    expect(deps.timers.hasPending()).toBe(true);

    deps.timers.advance(1000); // empty repeat #0 fires, nothing to speak, self-advances
    deps.timers.advance(1000); // empty repeat #1 fires, repeats exhausted, self-advances to long_wait
    deps.timers.advance(1000); // long_wait fires

    expect(deps.spoken).toEqual(["long-wait-a"]);
    expect(deps.timers.hasPending()).toBe(false); // fires exactly once, then nothing follows
  });

  it("resets per-turn state (repeatsSpoken, spoken tool ids, degraded, pending tool) but not the shuffle bags", () => {
    const deps = makeDeps({
      getPools: () => pool({ tool: { terminal: ["ack"] } }),
      isCached: () => false,
    });
    const loop = createFillerLoop(deps);
    loop.start();
    loop.onUtteranceDone();
    loop.onToolRunning("terminal"); // marks "terminal" pending, schedules the tool-gap timer
    loop.onSynthFailure(); // degrades

    loop.stop(); // drops the pending tool phrase and cancels its timer
    loop.start(); // new turn: degraded clears, pendingToolId resets
    deps.spoken.length = 0;

    // A leftover pendingToolId from the dropped turn must not resurrect "terminal"'s phrase here.
    loop.onUtteranceDone();
    expect(deps.spoken).toEqual([]);
    expect(deps.timers.hasPending()).toBe(true); // the normal filler repeat is armed instead

    loop.onToolRunning("terminal"); // "terminal" can speak again this turn
    deps.timers.advance(700);
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

  it("in phase tool, re-arms the tool-gap timer instead of leaving nothing pending", () => {
    const deps = makeDeps({ getPools: () => pool({ tool: { terminal: ["ack"] } }) });
    const loop = createFillerLoop(deps);
    loop.start();
    loop.onUtteranceDone();
    loop.onToolRunning("terminal"); // phase=tool, tool-gap timer armed
    expect(deps.timers.hasPending()).toBe(true);

    loop.onSynthFailure(); // e.g. the tool ack's own synth failed — the tool-gap timer must still be armed
    expect(deps.timers.hasPending()).toBe(true);

    deps.timers.advance(700);
    expect(deps.spoken).toContain("ack"); // pendingToolId survived the re-arm
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
    expect(deps.timers.hasPending()).toBe(false); // no tool-gap timer armed either
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
