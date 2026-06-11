/**
 * fall-integrator.test.ts — gravity fall integrator, driven by caller-supplied dt.
 *
 * No rAF / real clock: the caller steps the integrator with an explicit dt
 * (seconds) each frame, so behaviour is fully deterministic under vitest.
 * Units: position in logical px (screen-Y, down = +), time in seconds.
 */

import { describe, it, expect } from "vitest";
import { createFallIntegrator } from "./fall-integrator";
import { FALL_GRAVITY, FALL_TERMINAL_VELOCITY, FALL_MAX_DURATION_S } from "./fall-config";

const DT = 1 / 60;

/** Step the integrator at fixed dt until done, returning the sampled Y per frame. */
function runToCompletion(
  startY: number,
  targetY: number,
  dt = DT,
  maxFrames = 100_000,
): { samples: number[]; frames: number; finalDone: boolean } {
  const fall = createFallIntegrator(startY, targetY);
  const samples: number[] = [fall.y()];
  let frames = 0;
  let finalDone = false;
  while (!finalDone && frames < maxFrames) {
    finalDone = fall.step(dt);
    samples.push(fall.y());
    frames++;
  }
  return { samples, frames, finalDone };
}

describe("createFallIntegrator — gravity-style accelerating fall", () => {
  it("starts at startY and reports not-done before the first step", () => {
    const fall = createFallIntegrator(100, 500);
    expect(fall.y()).toBe(100);
    expect(fall.done()).toBe(false);
  });

  it("moves monotonically toward the target (downward, increasing screen-Y)", () => {
    const { samples } = runToCompletion(100, 800);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
    }
  });

  it("reaches the target and clamps exactly at it, never overshooting", () => {
    const targetY = 800;
    const { samples, finalDone } = runToCompletion(100, targetY);
    const last = samples[samples.length - 1];
    expect(finalDone).toBe(true);
    expect(last).toBe(targetY);
    // no sample ever passes the target
    for (const s of samples) expect(s).toBeLessThanOrEqual(targetY);
  });

  it("accelerates: later equal-dt steps cover more ground than earlier ones (until terminal)", () => {
    const fall = createFallIntegrator(0, 100_000); // far target so we stay pre-terminal
    const deltas: number[] = [];
    let prev = fall.y();
    for (let i = 0; i < 10; i++) {
      fall.step(DT);
      deltas.push(fall.y() - prev);
      prev = fall.y();
    }
    for (let i = 1; i < deltas.length; i++) {
      expect(deltas[i]).toBeGreaterThan(deltas[i - 1]);
    }
  });

  it("clamps velocity at terminal: per-step travel never exceeds terminal and plateaus", () => {
    // Far target so the fall runs the full cap window without snapping early.
    const fall = createFallIntegrator(0, 10_000_000);
    const terminalPerStep = FALL_TERMINAL_VELOCITY * DT;
    const deltas: number[] = [];
    let prev = fall.y();
    let done = false;
    while (!done) {
      done = fall.step(DT);
      if (!done) deltas.push(fall.y() - prev); // exclude the cap-snap frame
      prev = fall.y();
    }
    // no pre-cap step ever travels faster than terminal velocity allows
    for (const d of deltas) expect(d).toBeLessThanOrEqual(terminalPerStep + 1e-6);
    // and the fall does reach terminal: the last pre-cap step is at the clamp
    const lastDelta = deltas[deltas.length - 1];
    expect(lastDelta).toBeGreaterThan(terminalPerStep * 0.99);
  });

  it("terminates a very long fall via the max-duration cap (snaps to target)", () => {
    // A target unreachable within the cap at terminal velocity.
    const startY = 0;
    const targetY = FALL_TERMINAL_VELOCITY * FALL_MAX_DURATION_S * 10;
    const fall = createFallIntegrator(startY, targetY);
    let done = false;
    let frames = 0;
    const maxFrames = Math.ceil(FALL_MAX_DURATION_S / DT) + 5;
    while (!done && frames < maxFrames) {
      done = fall.step(DT);
      frames++;
    }
    expect(done).toBe(true);
    expect(fall.y()).toBe(targetY);
    expect(frames * DT).toBeLessThanOrEqual(FALL_MAX_DURATION_S + DT);
  });

  it("scales sub-linearly with distance: a 2x fall is not 2x the frames", () => {
    const near = runToCompletion(0, 300);
    const far = runToCompletion(0, 600);
    expect(far.frames).toBeGreaterThan(near.frames);
    // acceleration means doubling distance takes well under double the time
    expect(far.frames).toBeLessThan(near.frames * 2);
  });

  it("a tiny fall is not instant (takes more than one step)", () => {
    const { frames } = runToCompletion(0, 5);
    expect(frames).toBeGreaterThan(1);
  });

  it("done() stays true and y() holds at target after completion", () => {
    const fall = createFallIntegrator(0, 50);
    let done = false;
    while (!done) done = fall.step(DT);
    expect(fall.done()).toBe(true);
    const settled = fall.y();
    // further steps are no-ops
    expect(fall.step(DT)).toBe(true);
    expect(fall.y()).toBe(settled);
    expect(settled).toBe(50);
  });

  it("config exposes positive gravity, terminal velocity, and a duration cap", () => {
    expect(FALL_GRAVITY).toBeGreaterThan(0);
    expect(FALL_TERMINAL_VELOCITY).toBeGreaterThan(0);
    expect(FALL_MAX_DURATION_S).toBeGreaterThan(0);
  });
});
