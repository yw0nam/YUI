/**
 * index.test.ts — TDD red phase (Unit 2): renderer cycle-dwell wiring.
 *
 * createRenderer instantiates a real THREE.WebGLRenderer (needs a GL context that
 * neither node nor jsdom provides), so the renderer's dwell behavior is verified at
 * its observable seam: the cycle-dwell scheduler the renderer wires into
 * onMixerFinished (schedule the finish→commit→startMotion swap) and into startMotion
 * + teardown (cancel a pending swap). These tests model exactly that wiring with the
 * same global setTimeout the renderer uses, driven by vi.useFakeTimers().
 *
 * Renderer wiring under test (src/renderer/index.ts):
 *  - onMixerFinished: dwell.onFinish(isCycle, motionRegistry[id]?.cycle_dwell_ms, swap)
 *      where swap = () => { finish(id) → commit → startMotion(decision.motion) }.
 *  - startMotion (single motion-play sink): dwell.cancel() at the very top, so ANY
 *      new motion (drag interrupt, emotion oneshot, exit→idle) cancels a pending dwell.
 *  - teardownMotion/dispose: dwell.cancel() so no stale timer fires on a torn mixer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCycleDwell } from "./cycle-dwell";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** A registry slice mirroring configs/motions.json: window_sit cycles with a 4s dwell. */
const DWELL_MS = 4000;

describe("renderer cycle-dwell wiring — finished cycle motion defers the swap", () => {
  it("a finished cycle motion with cycle_dwell_ms>0 holds, then swaps once after the dwell", () => {
    const dwell = createCycleDwell();

    // onMixerFinished for window_sit (isCycle=true, dwell=4000): the swap is the
    // finish→commit→startMotion sequence that lands a different variant.
    const swap = vi.fn();
    dwell.onFinish(true, DWELL_MS, swap);

    // settled last frame is held (clip clampWhenFinished) — no swap yet.
    expect(swap).not.toHaveBeenCalled();

    vi.advanceTimersByTime(DWELL_MS - 1);
    expect(swap).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(swap).toHaveBeenCalledTimes(1);
  });
});

describe("renderer cycle-dwell wiring — interrupt during dwell cancels the swap", () => {
  it("a new startMotion (cancel at its top) during the dwell drops the pending swap", () => {
    const dwell = createCycleDwell();

    const deferredSwap = vi.fn();
    dwell.onFinish(true, DWELL_MS, deferredSwap);

    vi.advanceTimersByTime(1000);

    // Interrupt: a drag (p80>55) / emotion oneshot / exit→idle calls startMotion,
    // whose first act is dwell.cancel().
    dwell.cancel();

    vi.advanceTimersByTime(DWELL_MS);
    expect(deferredSwap).not.toHaveBeenCalled();
  });

  it("teardown during the dwell cancels the pending swap (no stale fire on a torn mixer)", () => {
    const dwell = createCycleDwell();

    const deferredSwap = vi.fn();
    dwell.onFinish(true, DWELL_MS, deferredSwap);

    // teardownMotion()/dispose() cancels.
    dwell.cancel();

    vi.advanceTimersByTime(DWELL_MS * 2);
    expect(deferredSwap).not.toHaveBeenCalled();
  });
});

describe("renderer cycle-dwell wiring — no-dwell motions swap immediately (regression)", () => {
  it("idle (cycle, cycle_dwell_ms absent) swaps synchronously on finish", () => {
    const dwell = createCycleDwell();
    const swap = vi.fn();

    // idle: isCycle=true but cycle_dwell_ms is undefined in the registry.
    dwell.onFinish(true, undefined, swap);
    expect(swap).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10000);
    expect(swap).toHaveBeenCalledTimes(1);
  });

  it("a non-cycle oneshot finish swaps synchronously on finish", () => {
    const dwell = createCycleDwell();
    const swap = vi.fn();

    dwell.onFinish(false, DWELL_MS, swap);
    expect(swap).toHaveBeenCalledTimes(1);
  });
});
