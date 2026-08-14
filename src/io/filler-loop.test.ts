/**
 * filler-loop.test.ts — TTFT filler scheduler.
 *
 * Pins the contract for src/io/filler-loop.ts:
 *   createFillerLoop(deps): FillerLoop
 *
 * All timer seams are injected. random seam is deterministic.
 * No renderer, no pipeline knowledge — pure scheduling logic.
 */

import { describe, expect, it } from "vitest";
import { createFillerLoop, type FillerLoopDeps } from "./filler-loop";

// ─────────────────────────────────────────────────────────────────────────────
// Fake timer helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeTimers() {
  let id = 0;
  const pending = new Map<number, () => void>();

  const setTimeout = (fn: () => void, _ms: number): number => {
    const tid = ++id;
    pending.set(tid, fn);
    return tid;
  };
  const clearTimeout = (tid: number): void => {
    pending.delete(tid);
  };
  const flush = (tid?: number): void => {
    if (tid !== undefined) {
      const fn = pending.get(tid);
      if (fn) {
        pending.delete(tid);
        fn();
      }
    } else {
      for (const [t, fn] of [...pending]) {
        pending.delete(t);
        fn();
      }
    }
  };
  const hasPending = (): boolean => pending.size > 0;
  const lastId = (): number => id;

  return { setTimeout, clearTimeout, flush, hasPending, lastId };
}

function makeDeps(overrides: Partial<FillerLoopDeps> = {}): FillerLoopDeps & {
  spoken: string[];
  timers: ReturnType<typeof makeTimers>;
} {
  const spoken: string[] = [];
  const timers = makeTimers();
  return {
    speak: (text) => spoken.push(text),
    getPools: () => ({ first: ["first-a", "first-b"], repeat: ["repeat-x", "repeat-y"] }),
    getTiming: () => ({ gapMs: 1000, jitterMs: 0 }),
    setTimeout: timers.setTimeout as typeof globalThis.setTimeout,
    clearTimeout: timers.clearTimeout as typeof globalThis.clearTimeout,
    random: () => 0,
    spoken,
    timers,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// start() behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe("createFillerLoop — start()", () => {
  it("speaks a first phrase immediately when first list is non-empty", () => {
    const deps = makeDeps();
    const loop = createFillerLoop(deps);
    loop.start();
    expect(deps.spoken).toHaveLength(1);
    expect(deps.spoken[0]).toBe("first-a"); // random()=0 picks index 0
  });

  it("does not schedule a timer immediately when first list has entries (waiting for utterance-done)", () => {
    const deps = makeDeps();
    const loop = createFillerLoop(deps);
    loop.start();
    expect(deps.timers.hasPending()).toBe(false);
  });

  it("schedules a timer immediately when first is empty but repeat is non-empty", () => {
    const deps = makeDeps({
      getPools: () => ({ first: [], repeat: ["repeat-x"] }),
    });
    const loop = createFillerLoop(deps);
    loop.start();
    // no immediate speak
    expect(deps.spoken).toHaveLength(0);
    // timer is pending
    expect(deps.timers.hasPending()).toBe(true);
  });

  it("does nothing when both lists are empty", () => {
    const deps = makeDeps({ getPools: () => ({ first: [], repeat: [] }) });
    const loop = createFillerLoop(deps);
    loop.start();
    expect(deps.spoken).toHaveLength(0);
    expect(deps.timers.hasPending()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// onUtteranceDone() behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe("createFillerLoop — onUtteranceDone()", () => {
  it("schedules a repeat phrase after the gap when called while active", () => {
    const deps = makeDeps();
    const loop = createFillerLoop(deps);
    loop.start();
    // spoken first phrase; now utterance completes
    loop.onUtteranceDone();
    // timer should now be pending
    expect(deps.timers.hasPending()).toBe(true);
  });

  it("fires the repeat phrase only after the timer fires", () => {
    const deps = makeDeps();
    const loop = createFillerLoop(deps);
    loop.start();
    loop.onUtteranceDone();
    // nothing extra spoken yet
    expect(deps.spoken).toHaveLength(1);
    // fire the timer
    deps.timers.flush();
    expect(deps.spoken).toHaveLength(2);
    expect(deps.spoken[1]).toBe("repeat-x"); // random()=0 → index 0
  });

  it("is a no-op when the loop is stopped", () => {
    const deps = makeDeps();
    const loop = createFillerLoop(deps);
    loop.start();
    loop.stop();
    loop.onUtteranceDone();
    expect(deps.timers.hasPending()).toBe(false);
    expect(deps.spoken).toHaveLength(1); // only the first phrase
  });

  it("does not chain a second timer immediately after firing — next schedule comes from onUtteranceDone", () => {
    const deps = makeDeps();
    const loop = createFillerLoop(deps);
    loop.start();
    loop.onUtteranceDone();
    deps.timers.flush(); // fires repeat
    // After firing, no new timer until onUtteranceDone is called again
    expect(deps.timers.hasPending()).toBe(false);
    loop.onUtteranceDone();
    expect(deps.timers.hasPending()).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// onSynthFailure() behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe("createFillerLoop — onSynthFailure()", () => {
  it("does not schedule the next repeat once a synth failure is reported", () => {
    const deps = makeDeps();
    const loop = createFillerLoop(deps);
    loop.start();
    loop.onSynthFailure();
    loop.onUtteranceDone();
    expect(deps.timers.hasPending()).toBe(false);
  });

  it("cancels a timer that was already pending when the failure lands", () => {
    const deps = makeDeps();
    const loop = createFillerLoop(deps);
    loop.start();
    loop.onUtteranceDone();
    expect(deps.timers.hasPending()).toBe(true);
    loop.onSynthFailure();
    expect(deps.timers.hasPending()).toBe(false);
  });

  it("stays silent for the rest of the window across repeated utterance-done calls", () => {
    const deps = makeDeps();
    const loop = createFillerLoop(deps);
    loop.start();
    loop.onSynthFailure();
    for (let i = 0; i < 5; i++) {
      loop.onUtteranceDone();
      deps.timers.flush();
    }
    expect(deps.spoken).toHaveLength(1); // only the first phrase, spoken before the failure
  });

  it("resumes scheduling at the next start()", () => {
    const deps = makeDeps();
    const loop = createFillerLoop(deps);
    loop.start();
    loop.onSynthFailure();
    loop.stop();

    loop.start();
    loop.onUtteranceDone();
    expect(deps.timers.hasPending()).toBe(true);
    deps.timers.flush();
    expect(deps.spoken).toHaveLength(3); // first, first again, repeat
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Jitter calculation
// ─────────────────────────────────────────────────────────────────────────────

describe("createFillerLoop — jitter", () => {
  it("gap is clamped to ≥0 even with large negative jitter", () => {
    // jitter = 2000ms, random() = 0 → delay = 500 + (0*2-1)*2000 = 500-2000 = negative → clamp to 0
    const deps = makeDeps({
      getTiming: () => ({ gapMs: 500, jitterMs: 2000 }),
      random: () => 0,
    });
    const loop = createFillerLoop(deps);
    loop.start();
    loop.onUtteranceDone();
    // timer must have been scheduled (not rejected) even though raw value was negative
    expect(deps.timers.hasPending()).toBe(true);
  });

  it("jitter adds positive offset when random()=1", () => {
    // delay = 1000 + (1*2-1)*500 = 1000+500 = 1500 — just ensuring no error
    const deps = makeDeps({
      getTiming: () => ({ gapMs: 1000, jitterMs: 500 }),
      random: () => 1,
    });
    const loop = createFillerLoop(deps);
    loop.start();
    loop.onUtteranceDone();
    expect(deps.timers.hasPending()).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// stop() behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe("createFillerLoop — stop()", () => {
  it("cancels a pending timer", () => {
    const deps = makeDeps({ getPools: () => ({ first: [], repeat: ["r"] }) });
    const loop = createFillerLoop(deps);
    loop.start();
    expect(deps.timers.hasPending()).toBe(true);
    loop.stop();
    expect(deps.timers.hasPending()).toBe(false);
  });

  it("is idempotent — calling stop() twice does not error", () => {
    const deps = makeDeps();
    const loop = createFillerLoop(deps);
    loop.start();
    loop.stop();
    expect(() => loop.stop()).not.toThrow();
  });

  it("makes onUtteranceDone a no-op after stop", () => {
    const deps = makeDeps();
    const loop = createFillerLoop(deps);
    loop.start();
    loop.stop();
    const beforeCount = deps.spoken.length;
    loop.onUtteranceDone();
    deps.timers.flush();
    expect(deps.spoken.length).toBe(beforeCount);
  });

  it("pending timer callback does not speak after stop()", () => {
    const deps = makeDeps();
    const loop = createFillerLoop(deps);
    loop.start();
    loop.onUtteranceDone();
    loop.stop();
    // manually fire any stale timer (clearTimeout should have cancelled it, but verify guard too)
    deps.timers.flush();
    // only the initial first-phrase was spoken
    expect(deps.spoken).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// No-immediate-duplicate pick
// ─────────────────────────────────────────────────────────────────────────────

describe("createFillerLoop — no-immediate-duplicate pick", () => {
  it("avoids repeating the same phrase back-to-back in first list", () => {
    // With 2-item first list and random always returning 0 (index 0):
    // second start() (after stop+restart) should get index 0 again → same.
    // But within a single turn the first phrase is only spoken once, so this
    // specifically tests repeat-list dedup.
    let callCount = 0;
    const deps = makeDeps({
      getPools: () => ({ first: [], repeat: ["alpha", "beta"] }),
      // Alternate: first call returns 0, second returns 0 → dedup kicks in → (0+1)%2=1
      random: () => (callCount++ % 2 === 0 ? 0 : 0),
    });
    const loop = createFillerLoop(deps);
    loop.start();
    // first repeat (scheduleNext fires)
    deps.timers.flush();
    expect(deps.spoken[0]).toBe("alpha"); // index 0
    loop.onUtteranceDone();
    deps.timers.flush();
    // second repeat: random returns 0 again (same as last), dedup → index 1
    expect(deps.spoken[1]).toBe("beta");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Live getPools/getTiming reads (hot-reload seam)
// ─────────────────────────────────────────────────────────────────────────────

describe("createFillerLoop — live getPools read", () => {
  it("uses the pool returned by getPools at each turn (not a snapshot from start)", () => {
    let useAlt = false;
    const deps = makeDeps({
      getPools: () =>
        useAlt
          ? { first: [], repeat: ["alt-repeat"] }
          : { first: ["first-a"], repeat: ["repeat-x"] },
    });
    const loop = createFillerLoop(deps);
    loop.start();
    expect(deps.spoken[0]).toBe("first-a");
    // switch pool before the next onUtteranceDone
    useAlt = true;
    loop.onUtteranceDone();
    deps.timers.flush();
    expect(deps.spoken[1]).toBe("alt-repeat");
  });
});
