/**
 * fall-sequence — the perched-character fall state machine (#143 U4).
 *
 * Ties the fall geometry (U2), integrator (U1), and preemption primitive (U0)
 * into one controller that drives a perched character down to the work-area
 * bottom and into its land/react beats. Fully dependency-injected: no three.js,
 * Tauri, or DOM is touched here — the renderer supplies playMotion / a clip
 * completion signal / a per-frame tick hook / preemption, and Tauri supplies an
 * optional window mover. That keeps the whole machine unit-testable with fakes.
 *
 * State machine:
 *   detaching → falling → landing → reacting → idle
 *   (motion ids: "falling" → "landing" → "suneru" → null)
 *
 * The controller is the SOLE playMotion driver for the duration of a sequence
 * (must-fix #3) — it never leans on motion priority to protect the fall. It owns
 * a single tick hook that is always unregistered on land / cancel / abort
 * (no setInterval, bounded one-shot).
 */

import type { ScreenRect } from "../contract";
import { computeTargetY } from "./fall-geometry";
import { createFallIntegrator } from "./fall-integrator";
import {
  FALLING_MOTION_ID,
  LANDING_MOTION_ID,
  LANDING_REACTION_ID,
  SETPOS_MIN_DELTA_PX,
  SETPOS_MIN_INTERVAL_S,
  FALL_GEOMETRY_TIMEOUT_MS,
} from "./fall-config";

/**
 * Fall state machine phases. A const object (not an `enum`) so the syntax is
 * type-erasable while `FallState.Falling` still reads as a runtime value.
 *
 *   Detaching  — pre-fall: capturing generation, resolving geometry.
 *   Falling    — integrator-driven plunge with throttled window Y-steps.
 *   Landing    — landing oneshot playing to completion.
 *   Reacting   — reaction (suneru) oneshot playing to completion.
 *   Idle       — settled; idle motion (playMotion(null)) issued.
 *   Cancelled  — preempted/cancelled; no further transitions, takeover owns the character.
 */
export const FallState = {
  Detaching: "detaching",
  Falling: "falling",
  Landing: "landing",
  Reacting: "reacting",
  Idle: "idle",
  Cancelled: "cancelled",
} as const;

export type FallState = (typeof FallState)[keyof typeof FallState];

/** Logical-px window geometry probe (Tauri outerPosition/size → points). */
export interface WindowGeom {
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
}

/** Optional Tauri window mover. Undefined off-Tauri → Phase-1 idle fallback. */
export interface WindowMover {
  /** Move the pet window top-left to (xLogical, yLogical) in points. */
  setPosition(xLogical: number, yLogical: number): Promise<void>;
  /** Work area of the window's current monitor, in points, plus its scale. */
  getWorkArea(): Promise<ScreenRect & { scaleFactor: number }>;
  /** Live pet-window geometry in points. */
  getWindowGeom(): Promise<WindowGeom>;
}

export interface FallSequenceDeps {
  /** Play a motion id, or null for idle. The controller's only motion channel. */
  playMotion(id: string | null): void;
  /** Resolves when the given oneshot motion finishes (clean hand-off, not a cut). */
  whenMotionFinished(id: string): Promise<void>;
  /** Optional — absent off-Tauri, which forces the idle fallback. */
  windowMover?: WindowMover;
  /** Live posed-box feet-from-window-top in logical px. Frozen once at fall start. */
  measureFeetPx(): number;
  /** Register a per-frame hook (dt seconds); returns an unregister fn. */
  onTick(fn: (dt: number) => void): () => void;
  /** Push signal: the active motion was superseded (re-grab, dispose, …). */
  onMotionPreempted(cb: (e: { prevId: string; nextId: string | null }) => void): () => void;
  /** Pull guard: capture at start, re-check after each async hop. */
  motionGeneration(): number;
  isMotionGenerationCurrent(captured: number): boolean;
  /** Read once by the caller (matchMedia). Skips the animated plunge. */
  reducedMotion: boolean;
}

export interface FallSequence {
  /** Begin the sequence. Re-entrant calls while active are ignored (idempotent). */
  start(): void;
  /** Abort for dispose / re-exit: unregister the tick, stop transitions, no forced idle. */
  cancel(): void;
  /** Current state (for tests / wiring observability). */
  state(): FallState;
}

/** Reject if `p` doesn't settle within `ms` — keeps a hung probe from freezing the detach. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("fall geometry timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export function createFallSequence(deps: FallSequenceDeps): FallSequence {
  let phase: FallState = FallState.Idle;
  let captured = 0;
  let unsubPreempt: (() => void) | null = null;
  let unTick: (() => void) | null = null;

  /** Active iff a sequence is mid-flight (start() is ignored in these phases). */
  function isActive(): boolean {
    return (
      phase === FallState.Detaching ||
      phase === FallState.Falling ||
      phase === FallState.Landing ||
      phase === FallState.Reacting
    );
  }

  /** True once cancelled/preempted or the captured generation went stale. */
  function aborted(): boolean {
    return phase === FallState.Cancelled || !deps.isMotionGenerationCurrent(captured);
  }

  function clearTick(): void {
    if (unTick) {
      unTick();
      unTick = null;
    }
  }

  function teardown(): void {
    clearTick();
    if (unsubPreempt) {
      unsubPreempt();
      unsubPreempt = null;
    }
  }

  /** Hard abort: tick gone, no transitions, no forced idle (takeover owns the character). */
  function cancel(): void {
    phase = FallState.Cancelled;
    teardown();
  }

  /** Phase-1 fallback: no animated fall — straight to idle motion. */
  function fallbackToIdle(): void {
    teardown();
    deps.playMotion(null);
    phase = FallState.Idle;
  }

  /** landing oneshot → reaction oneshot → idle. Aborts at every async boundary if stale. */
  async function landReactSettle(): Promise<void> {
    phase = FallState.Landing;
    deps.playMotion(LANDING_MOTION_ID);
    await deps.whenMotionFinished(LANDING_MOTION_ID);
    if (aborted()) return;

    phase = FallState.Reacting;
    deps.playMotion(LANDING_REACTION_ID);
    await deps.whenMotionFinished(LANDING_REACTION_ID);
    if (aborted()) return;

    teardown();
    deps.playMotion(null);
    phase = FallState.Idle;
  }

  /** Integrator-driven plunge: compute Y every frame, throttle the IPC setPosition. */
  function runFall(workArea: ScreenRect, startY: number, targetY: number): void {
    phase = FallState.Falling;
    deps.playMotion(FALLING_MOTION_ID);

    const integrator = createFallIntegrator(startY, targetY);
    let lastIssuedY = startY;
    let sinceLast = 0; // seconds since the last issued setPosition
    let inFlight = false;

    // Fire-and-forget window step. A resolve that comes back stale (cancel /
    // dispose / new sequence) is discarded so we never yank the window out from
    // under a takeover. The landing hand-off does NOT wait on this resolve —
    // it's driven synchronously by integrator.done() below.
    const issue = (y: number): void => {
      inFlight = true;
      void deps
        .windowMover!.setPosition(workArea.x, y)
        .then(() => {
          if (aborted()) return;
          inFlight = false;
        })
        .catch(() => {
          inFlight = false;
        });
    };

    unTick = deps.onTick((dt) => {
      if (aborted()) {
        clearTick();
        return;
      }
      const done = integrator.step(dt);
      const y = integrator.y();
      sinceLast += dt;

      if (done) {
        // Snap the window to the exact target, then advance deterministically —
        // the transition is synchronous, not chained off the IPC resolve.
        clearTick();
        issue(y);
        void landReactSettle();
        return;
      }

      const movedEnough = Math.abs(y - lastIssuedY) >= SETPOS_MIN_DELTA_PX;
      const intervalElapsed = sinceLast >= SETPOS_MIN_INTERVAL_S;
      if (movedEnough && intervalElapsed && !inFlight) {
        lastIssuedY = y;
        sinceLast = 0;
        issue(y);
      }
    });
  }

  async function begin(): Promise<void> {
    // Capture generation FIRST so any preemption from here on is detectable.
    captured = deps.motionGeneration();
    phase = FallState.Detaching;

    unsubPreempt = deps.onMotionPreempted(() => {
      // Any supersession during the sequence is a takeover — abort, no forced idle.
      if (isActive()) cancel();
    });

    const mover = deps.windowMover;
    if (!mover) {
      fallbackToIdle();
      return;
    }

    // Resolve geometry under a deadline; ANY failure/timeout → Phase-1 idle.
    let workAreaInfo: ScreenRect & { scaleFactor: number };
    let geom: WindowGeom;
    try {
      workAreaInfo = await withTimeout(mover.getWorkArea(), FALL_GEOMETRY_TIMEOUT_MS);
      if (aborted()) return;
      geom = await withTimeout(mover.getWindowGeom(), FALL_GEOMETRY_TIMEOUT_MS);
      if (aborted()) return;
    } catch {
      // A preemption during the await already owns the character — don't override.
      if (!aborted()) fallbackToIdle();
      return;
    }

    const workArea: ScreenRect = {
      x: workAreaInfo.x,
      y: workAreaInfo.y,
      width: workAreaInfo.width,
      height: workAreaInfo.height,
    };
    // Freeze the feet measurement once, at fall start.
    const feetPxFromWindowTop = deps.measureFeetPx();

    const { targetWinY, skipFall } = computeTargetY({
      winY: geom.y,
      winH: geom.h,
      feetPxFromWindowTop,
      workArea,
    });

    if (skipFall) {
      // Already at/below the landing — no plunge, straight to land + react.
      void landReactSettle();
      return;
    }

    if (deps.reducedMotion) {
      // Skip the animated plunge: one instant snap to the bottom, then land-react.
      try {
        await mover.setPosition(workArea.x, targetWinY);
      } catch {
        if (!aborted()) fallbackToIdle();
        return;
      }
      if (aborted()) return;
      void landReactSettle();
      return;
    }

    runFall(workArea, geom.y, targetWinY);
  }

  return {
    start() {
      if (isActive()) return; // idempotent while a sequence runs
      phase = FallState.Detaching;
      void begin();
    },
    cancel,
    state() {
      return phase;
    },
  };
}
