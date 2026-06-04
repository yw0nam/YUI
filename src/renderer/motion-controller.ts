/**
 * MotionController — pure state machine for motion scheduling / variant resolution.
 * NO three.js import. No rendering side-effects.
 *
 * This file is a STUB: all methods return placeholder values so that
 * `pnpm build` passes and type-checks succeed.  The real implementation
 * (Renderer agent) will replace the stub bodies while keeping the exported
 * surface identical.
 *
 * Exported surface (contract):
 *   createMotionController(registry, opts?) → MotionController
 */

import type {
  MotionRegistry,
  MotionSignal,
  MotionKind,
  InterruptPolicy,
} from "../contract";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface ResolvedMotion {
  id: string;
  /** variant-resolved concrete VRMA path */
  vrma_path: string;
  loop: boolean;
  /** clamped to [0.25, 2.5] */
  speed: number;
  /** >= 0, default 200 */
  fade_ms: number;
  kind: MotionKind;
  priority: number;
  interrupt_policy: InterruptPolicy;
}

export type MotionDecision =
  | { action: "play"; motion: ResolvedMotion }
  | { action: "queue"; motion: ResolvedMotion }
  | { action: "ignore"; reason: string };

export interface MotionControllerOptions {
  /** default "idle" */
  baselineId?: string;
  /** default Math.random — injectable for deterministic variant tests */
  rng?: () => number;
  /** default console.warn */
  warn?: (msg: string) => void;
}

export interface MotionController {
  /**
   * Resolves a MotionSignal against the registry (variant pick, clamp, defaults).
   * Returns null if the id is not registered.
   */
  resolve(signal: MotionSignal): ResolvedMotion | null;

  /**
   * Decides whether to play, queue, or ignore an incoming signal given the
   * current playback state and interrupt policies.
   * Pass null to request a return to the baseline motion.
   */
  request(signal: MotionSignal | null): MotionDecision;

  /**
   * Called when a motion finishes (e.g. a oneshot ends).
   * Returns a decision for what to play next (drain queue or return baseline).
   */
  finish(id: string): MotionDecision;

  /**
   * Commits a decision, updating the internal state.
   * Only "play" and "queue" decisions mutate state; "ignore" is a no-op.
   */
  commit(decision: MotionDecision): void;

  /** Returns the currently committed (playing) motion, or null if none. */
  current(): ResolvedMotion | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory — STUB implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a MotionController backed by the given registry.
 *
 * STUB: all methods return placeholder values; no real logic is implemented.
 * Tests that exercise real behaviour WILL FAIL against this stub — that is
 * intentional (TDD red phase).
 */
export function createMotionController(
  _registry: MotionRegistry,
  _opts?: MotionControllerOptions,
): MotionController {
  return {
    resolve(_signal: MotionSignal): ResolvedMotion | null {
      return null;
    },

    request(_signal: MotionSignal | null): MotionDecision {
      return { action: "ignore", reason: "stub" };
    },

    finish(_id: string): MotionDecision {
      return { action: "ignore", reason: "stub" };
    },

    commit(_decision: MotionDecision): void {
      // stub no-op
    },

    current(): ResolvedMotion | null {
      return null;
    },
  };
}
