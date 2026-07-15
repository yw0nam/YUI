/**
 * MotionController — pure state machine for motion scheduling / variant resolution.
 * NO three.js import. No rendering side-effects.
 *
 * Responsibility: registry lookup + variant selection + apply clamp/defaults (resolve), decide
 * play/queue/ignore per interrupt policy (request), return after oneshot ends (finish),
 * hold single-slot queue/current motion state (commit/current).
 *
 * Exported surface (contract):
 *   createMotionController(registry, opts?) → MotionController
 */

import type { InterruptPolicy, MotionKind, MotionRegistry, MotionSignal } from "../contract";
import { createLogger } from "../logger";

const log = createLogger("motion-controller");

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface ResolvedMotion {
  id: string;
  /** variant-resolved concrete VRMA path */
  vrma_path: string;
  loop: boolean;
  /** looping motion with >1 variants — renderer plays each variant once and chains a fresh variant on finish. */
  cycle: boolean;
  /**
   * pingpong=false                          → existing behavior (loop_reps unused, 0)
   * pingpong=true, cycle=false, reps=Inf    → single-variant continuous pingpong (thinking)
   * pingpong=true, cycle=true,  reps=2N     → multi-variant pingpong cycle (idle, window_sit)
   */
  pingpong: boolean;
  /** LoopPingPong repetitions. Even finite 2N (multi-variant → finished→swap) | Infinity (single-variant → continuous) | 0 when pingpong=false. */
  loop_reps: number;
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
  /** default logger.warn */
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

  /** Returns the configured baseline motion id (single source of truth). */
  baseline(): string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const SPEED_MIN = 0.25;
const SPEED_MAX = 2.5;
const DEFAULT_FADE_MS = 200;

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a MotionController backed by the given registry.
 *
 * - rng: for variant selection (enables deterministic tests when injected); default Math.random.
 * - warn: warns on unregistered id / speed clamp; default logger.warn.
 * - baselineId: return target for request(null)/finish; default "idle".
 */
export function createMotionController(
  registry: MotionRegistry,
  opts?: MotionControllerOptions,
): MotionController {
  const baselineId = opts?.baselineId ?? "idle";
  const rng = opts?.rng ?? Math.random;
  const warn = opts?.warn ?? ((msg: string) => log.warn(msg));

  /** Per-id cursor for sequential variant_policy. */
  const seqCursors = new Map<string, number>();

  /** Per-id prior selected index for random variant_policy — avoids repetition. */
  const lastRandomIndex = new Map<string, number>();

  /** Currently playing (committed) motion. */
  let current: ResolvedMotion | null = null;
  /** Tracks ambient/state motion — return target after oneshot ends. */
  let previousStable: ResolvedMotion | null = null;
  /** Single-slot queue. */
  let queued: ResolvedMotion | null = null;

  function resolve(signal: MotionSignal): ResolvedMotion | null {
    const entry = registry[signal.id];
    if (!entry) {
      warn(`[MotionController] unregistered motion id: "${signal.id}"`);
      return null;
    }

    // Select variant.
    let vrma_path = entry.vrma_path;
    const variants = entry.variants;
    if (variants && variants.length > 0) {
      const policy = entry.variant_policy ?? "random";
      if (policy === "sequential") {
        const cursor = seqCursors.get(signal.id) ?? 0;
        vrma_path = variants[cursor]!;
        seqCursors.set(signal.id, (cursor + 1) % variants.length);
      } else {
        // random (default) — if same as previous index, shift by one to avoid repetition.
        let index = Math.min(variants.length - 1, Math.floor(rng() * variants.length));
        const last = lastRandomIndex.get(signal.id);
        if (last === index && variants.length > 1) {
          index = (index + 1) % variants.length;
        }
        lastRandomIndex.set(signal.id, index);
        vrma_path = variants[index]!;
      }
    }

    // speed: signal override → clamp to [0.25, 2.5], warn once if out of range.
    let speed = signal.speed ?? 1;
    if (speed < SPEED_MIN || speed > SPEED_MAX) {
      warn(`[MotionController] speed ${speed} out of range [${SPEED_MIN}, ${SPEED_MAX}] — clamped`);
      speed = Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed));
    }

    // fade_ms: signal → entry default → 200, >= 0 (0 is valid).
    const fade_ms = signal.fade_ms ?? entry.fade_ms ?? DEFAULT_FADE_MS;

    const loop = signal.loop ?? entry.loop;
    const cycle = loop && (!!(variants && variants.length > 1) || !!entry.crossfade_loop);

    // `&& loop` guard is NON-NEGOTIABLE: a true pingpong with loop=false would yield
    // setLoop(LoopPingPong, 0) downstream (undefined three.js behavior). Load
    // validation already rejects that combo; this is cheap defense in depth.
    const pingpong = !!entry.pingpong && loop;
    let loop_reps = 0;
    if (pingpong) {
      if (variants && variants.length > 1) {
        const [lo, hi] = entry.loop_cycles ?? [1, 1];
        // Math.min clamp guards rng() === 1.0 (test stubs); load already enforces lo<=hi.
        const n = Math.min(hi, lo + Math.floor(rng() * (hi - lo + 1))); // int in [lo,hi]
        loop_reps = 2 * n; // round trips → reps (even)
      } else {
        loop_reps = Infinity; // single-variant → continuous
      }
    }

    return {
      id: signal.id,
      vrma_path,
      loop,
      cycle,
      pingpong,
      loop_reps,
      speed,
      fade_ms,
      kind: entry.kind,
      priority: entry.priority,
      interrupt_policy: entry.interrupt_policy,
    };
  }

  function request(signal: MotionSignal | null): MotionDecision {
    // null → return to baseline.
    if (signal === null) {
      if (current && current.id === baselineId) {
        return {
          action: "ignore",
          reason: `already at baseline "${baselineId}"`,
        };
      }
      const baseline = resolve({ id: baselineId });
      if (!baseline) {
        return {
          action: "ignore",
          reason: `baseline "${baselineId}" not registered`,
        };
      }
      return { action: "play", motion: baseline };
    }

    const incoming = resolve(signal);
    if (!incoming) {
      return { action: "ignore", reason: `unregistered motion "${signal.id}"` };
    }

    if (!current) {
      return { action: "play", motion: incoming };
    }

    if (incoming.priority >= current.priority) {
      return { action: "play", motion: incoming };
    }

    // incoming priority is lower → decide by incoming's interrupt_policy.
    switch (incoming.interrupt_policy) {
      case "replace":
        return { action: "play", motion: incoming };
      case "queue":
        return { action: "queue", motion: incoming };
      default:
        return {
          action: "ignore",
          reason: `"${incoming.id}" (p${incoming.priority}) < current "${current.id}" (p${current.priority}), policy=ignore`,
        };
    }
  }

  function finish(id: string): MotionDecision {
    if (!current || id !== current.id) {
      return {
        action: "ignore",
        reason: `finish("${id}") but current is "${current?.id ?? "none"}"`,
      };
    }

    // if queue is full, drain it.
    if (queued) {
      const next = queued;
      queued = null;
      return { action: "play", motion: next };
    }

    // if cycle motion (e.g., idle), re-resolve same id and chain a new variant.
    if (current.cycle) {
      const next = resolve({ id: current.id });
      if (next) return { action: "play", motion: next };
    }

    // otherwise return to prior stable motion (ambient/state), or baseline if none.
    const next = previousStable ?? resolve({ id: baselineId });
    if (!next) {
      return {
        action: "ignore",
        reason: `no previousStable and baseline "${baselineId}" not registered`,
      };
    }
    return { action: "play", motion: next };
  }

  function commit(decision: MotionDecision): void {
    if (decision.action === "play") {
      current = decision.motion;
      if (decision.motion.kind === "ambient" || decision.motion.kind === "state") {
        previousStable = decision.motion;
      }
    } else if (decision.action === "queue") {
      queued = decision.motion;
    }
    // "ignore" → no-op.
  }

  return {
    resolve,
    request,
    finish,
    commit,
    current() {
      return current;
    },
    baseline() {
      return baselineId;
    },
  };
}
