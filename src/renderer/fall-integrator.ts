/**
 * fall-integrator — gravity-style vertical fall, stepped by caller-supplied dt.
 *
 * No three.js / DOM / rAF: the caller passes dt (seconds) each frame, so it's
 * deterministic under a fake clock. True integrator (v += g*dt; y += v*dt) with
 * a terminal-velocity clamp and a max-duration cap, giving an accelerating
 * ease-in independent of distance — a tiny fall isn't instant, a full-screen
 * one isn't sluggish.
 *
 * Units: y in logical px (screen-Y, down = +), dt/elapsed in seconds. Falling
 * means targetY > startY; clamping is direction-agnostic so an upward target
 * also settles without overshoot.
 */

import { FALL_GRAVITY, FALL_TERMINAL_VELOCITY, FALL_MAX_DURATION_S } from "./fall-config";

export interface FallIntegrator {
  /** Advance one frame by dt seconds. Returns true once the fall is complete. */
  step(dt: number): boolean;
  /** Current Y in logical px. */
  y(): number;
  /** True once the target was reached or the duration cap elapsed. */
  done(): boolean;
}

/**
 * Create a fall from `startY` to `targetY` (logical px). Drive it with
 * {@link FallIntegrator.step} once per frame; it clamps exactly at the target
 * on the final step and never overshoots past it.
 */
export function createFallIntegrator(startY: number, targetY: number): FallIntegrator {
  const sign = targetY >= startY ? 1 : -1;
  let pos = startY;
  let vel = 0;
  let elapsed = 0;
  let finished = startY === targetY;

  function reachedTarget(): boolean {
    return sign > 0 ? pos >= targetY : pos <= targetY;
  }

  return {
    step(dt) {
      if (finished) return true;

      elapsed += dt;
      vel = Math.min(vel + FALL_GRAVITY * dt, FALL_TERMINAL_VELOCITY);
      pos += sign * vel * dt;

      if (reachedTarget() || elapsed >= FALL_MAX_DURATION_S) {
        pos = targetY;
        finished = true;
      }
      return finished;
    },
    y() {
      return pos;
    },
    done() {
      return finished;
    },
  };
}
