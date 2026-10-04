/**
 * Frame loop — owns the rAF loop, the clock, the hidden-document pause/resume and the
 * idle-throttle gate. Each frame steps the camera rig, then the VRM-bound steppers.
 */

import type { VRM } from "@pixiv/three-vrm";
import * as THREE from "three";
import type { Logger } from "../logger";
import { isActive, shouldRenderFrame } from "./frame-gate";
import type { TickContext, TickFn } from "./types";
import { anyConverging, stepParticipants, type VrmParticipant } from "./vrm-participant";

/** Idle (ambient-only) frame cap — full refresh is reserved for active animation. */
const IDLE_FPS = 30;

/** A per-frame stepper that also reports whether it is still animating. */
interface FrameStepper {
  isConverging(): boolean;
}

interface FrameLoopDeps {
  participants: readonly VrmParticipant[];
  motion: FrameStepper & { step(ctx: TickContext): void };
  rig: FrameStepper & { step(): void };
  rootYaw: FrameStepper & { step(ctx: TickContext): void };
  tickHooks: ReadonlySet<TickFn>;
  getVrm: () => VRM | undefined;
  /** Draws the scene and refreshes whatever reads the fresh frame. */
  render: () => void;
  log: Logger;
}

export interface FrameLoop {
  /** Draws the first frame now and listens for document visibility changes. */
  start(): void;
  dispose(): void;
  /** Idle 30fps cap toggle (runtime). Disabled ⇒ idle frames render at full refresh. */
  setIdleThrottleEnabled(enabled: boolean): void;
  /** Time accumulated by frames stepped with a VRM loaded, in ms. */
  elapsedMs(): number;
}

export function createFrameLoop(deps: FrameLoopDeps): FrameLoop {
  const { participants, motion, rig, rootYaw, tickHooks, getVrm, render, log } = deps;

  const clock = new THREE.Clock();
  let elapsed = 0;
  let rafId = 0;
  // Frame-throttle bookkeeping: last rendered timestamp (perf-clock ms) for the
  // idle fps cap; null = no frame drawn yet (or just resumed) ⇒ draw immediately.
  let lastRenderMs: number | null = null;
  // True while the rAF loop is paused because the document is hidden/minimized.
  let paused = false;
  let idleThrottleEnabled = true;

  function animate(): void {
    rafId = requestAnimationFrame(animate);
    // Idle/active frame gate: while only ambient is running, cap to IDLE_FPS so the
    // frame budget is spared; full refresh is reserved for active animation. Skipped
    // frames do NOT consume the clock delta — it accumulates into the next rendered
    // frame so animation speed is unchanged.
    const active =
      isActive({
        participantsConverging: anyConverging(participants),
        motionActive: motion.isConverging(),
      }) ||
      rig.isConverging() ||
      rootYaw.isConverging();
    const now = performance.now();
    if (!shouldRenderFrame(now, lastRenderMs, active, IDLE_FPS, idleThrottleEnabled)) return;
    lastRenderMs = now;

    const dt = clock.getDelta();
    // Ease the orbit polar toward its target (free, or perched-clamped) and re-fit.
    // Independent of the VRM — rig.fit no-ops without a model — so the camera settles
    // even between loads. Cheap when already settled (no re-fit).
    rig.step();
    const currentVrm = getVrm();
    if (currentVrm) {
      elapsed += dt;
      const ctx: TickContext = { vrm: currentVrm, dt, elapsed };
      // Hooks first — bone/expression changes must be reflected in this frame's vrm.update(spring/expression apply).
      if (tickHooks.size > 0) {
        for (const fn of tickHooks) {
          try {
            fn(ctx);
          } catch (err) {
            log.error("tick_hook_error", { error: String(err) });
          }
        }
      }
      // Mixer first — after bone update, vrm.update applies spring/expression.
      motion.step(ctx);
      rootYaw.step(ctx);
      // pins/gaze (bones) then emotion/mouth (expression weights) — all before
      // vrm.update so expressionManager.update()/spring bones see this frame's writes.
      stepParticipants(participants, ctx);
      currentVrm.update(dt);
    }
    render();
  }

  // Pause the rAF loop entirely while the document is hidden/minimized; resume the
  // moment it is visible again. On resume, discard the paused gap (getDelta returns
  // the whole hidden duration otherwise — that would teleport animations) and clear
  // lastRenderMs so the first frame draws immediately.
  function onVisibilityChange(): void {
    if (document.visibilityState === "hidden") {
      if (paused) return;
      paused = true;
      cancelAnimationFrame(rafId);
      rafId = 0;
    } else {
      if (!paused) return;
      paused = false;
      clock.getDelta(); // drop the accumulated hidden gap so dt doesn't jump.
      lastRenderMs = null;
      animate();
    }
  }

  return {
    start() {
      animate();
      document.addEventListener("visibilitychange", onVisibilityChange);
    },
    dispose() {
      cancelAnimationFrame(rafId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    },
    setIdleThrottleEnabled(enabled) {
      idleThrottleEnabled = enabled;
    },
    elapsedMs: () => elapsed * 1000,
  };
}
