/**
 * cycle-dwell.test.ts — TDD red phase (Unit 2).
 *
 * createCycleDwell is the renderer's dwell scheduler: when a cycle motion's clip
 * finishes and its registry entry carries cycle_dwell_ms > 0, the swap to the next
 * variant is held for that many ms (the clip already clamps on its settled last
 * frame). Any new motion play cancels a pending dwell so an interrupt is never
 * delayed and no stale swap fires after the motion changed.
 *
 * The scheduler uses the global setTimeout/clearTimeout, driven here with
 * vi.useFakeTimers() — the same observable seam the renderer wires onFinish/cancel
 * into (onMixerFinished schedules; startMotion + teardown cancel).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCycleDwell } from "./cycle-dwell";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createCycleDwell — cycle motion with dwell", () => {
  it("does NOT run the swap synchronously; runs exactly once after dwell elapses", () => {
    const swap = vi.fn();
    const dwell = createCycleDwell();

    dwell.onFinish(true, 4000, swap);
    expect(swap).not.toHaveBeenCalled();
    expect(dwell.pending()).toBe(true);

    // not yet
    vi.advanceTimersByTime(3999);
    expect(swap).not.toHaveBeenCalled();

    // dwell elapsed → exactly one swap
    vi.advanceTimersByTime(1);
    expect(swap).toHaveBeenCalledTimes(1);
    expect(dwell.pending()).toBe(false);
  });

  it("cancel() during the dwell prevents the deferred swap entirely", () => {
    const swap = vi.fn();
    const dwell = createCycleDwell();

    dwell.onFinish(true, 4000, swap);
    expect(dwell.pending()).toBe(true);

    // an interrupt (new motion play / teardown) cancels before the timer fires
    dwell.cancel();
    expect(dwell.pending()).toBe(false);

    vi.advanceTimersByTime(10000);
    expect(swap).not.toHaveBeenCalled();
  });

  it("a fresh onFinish during a pending dwell cancels the prior pending swap (single timer)", () => {
    const first = vi.fn();
    const second = vi.fn();
    const dwell = createCycleDwell();

    dwell.onFinish(true, 4000, first);
    vi.advanceTimersByTime(1000);

    // a second finish reschedules — the first pending swap must not fire
    dwell.onFinish(true, 4000, second);
    vi.advanceTimersByTime(4000);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("createCycleDwell — immediate (regression: no behavior change)", () => {
  it("non-cycle motion runs the swap synchronously, schedules nothing", () => {
    const swap = vi.fn();
    const dwell = createCycleDwell();

    dwell.onFinish(false, 4000, swap);
    expect(swap).toHaveBeenCalledTimes(1);
    expect(dwell.pending()).toBe(false);

    vi.advanceTimersByTime(10000);
    expect(swap).toHaveBeenCalledTimes(1); // no second fire
  });

  it("cycle motion with dwell 0 runs the swap synchronously", () => {
    const swap = vi.fn();
    const dwell = createCycleDwell();

    dwell.onFinish(true, 0, swap);
    expect(swap).toHaveBeenCalledTimes(1);
    expect(dwell.pending()).toBe(false);
  });

  it("cycle motion with absent/undefined dwell runs the swap synchronously", () => {
    const swap = vi.fn();
    const dwell = createCycleDwell();

    dwell.onFinish(true, undefined, swap);
    expect(swap).toHaveBeenCalledTimes(1);
    expect(dwell.pending()).toBe(false);
  });
});

describe("createCycleDwell — cancel() is idempotent and safe with no pending", () => {
  it("cancel() with nothing pending is a no-op and does not throw", () => {
    const dwell = createCycleDwell();
    expect(() => dwell.cancel()).not.toThrow();
    expect(dwell.pending()).toBe(false);
  });
});
