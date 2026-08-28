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

/**
 * Renderer-local motion signal. The wire only carries the registry key; the playback
 * overrides are local callers (devtools preview).
 */
export interface RenderMotionSignal extends MotionSignal {
  /** Overrides registry default. */
  loop?: boolean;
  /** Speed multiplier: 0.25~2.5, default 1.0. */
  speed?: number;
  /** Crossfade duration in milliseconds, default 200. */
  fade_ms?: number;
}

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
  /** Strip the clip's baked vertical travel — the mover supplies it instead. */
  root_lock_y: boolean;
}

type MotionDecision =
  | { action: "play"; motion: ResolvedMotion }
  | { action: "queue"; motion: ResolvedMotion }
  | { action: "ignore"; reason: string };

interface MotionControllerOptions {
  /** default "idle" */
  baselineId?: string;
  /** default Math.random — injectable for deterministic variant tests */
  rng?: () => number;
  /** default logger.warn */
  warn?: (msg: string) => void;
  /**
   * Narrows a pool's variants to the ones the user allows. Consulted on every resolve, so a
   * selection change applies to the next rotation without re-creating the controller. An empty
   * result falls through to the entry's own `vrma_path`.
   */
  variantFilter?: (id: string, variants: readonly string[]) => readonly string[];
}

export interface MotionController {
  /**
   * Resolves a motion signal against the registry (variant pick, clamp, defaults).
   * Returns null if the id is not registered.
   */
  resolve(signal: RenderMotionSignal): ResolvedMotion | null;

  /**
   * Decides whether to play, queue, or ignore an incoming signal given the
   * current playback state and interrupt policies.
   * Pass null to request a return to the baseline motion.
   */
  request(signal: RenderMotionSignal | null): MotionDecision;

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

  /**
   * Drops the cached return target when it belongs to `id`. finish() then re-resolves that id
   * instead of replaying a resolution captured before its variant selection changed. Other pools
   * keep their cached resolution, so a held pose still resumes exactly as it was.
   */
  invalidatePool(id: string): void;
}

/**
 * Whether changing `poolId`'s variant selection has to restart it to take effect.
 *
 * A cycling pool re-resolves on every finish, so a change lands on the next rotation by itself.
 * A pool narrowed to one variant resolves with `cycle: false` and loops continuously — it never
 * finishes, so without a restart it would stay on that variant even after the pool widens again.
 */
export function needsRestartOnPoolChange(current: ResolvedMotion | null, poolId: string): boolean {
  return !!current && current.id === poolId && !current.cycle;
}

/** Whether a newly applied variant selection differs from the one already in force. */
export function poolSelectionChanged(
  previous: readonly string[] | null,
  next: readonly string[],
): boolean {
  return (
    !previous || previous.length !== next.length || next.some((path, i) => path !== previous[i])
  );
}

/**
 * Whether applying `next` over `previous` has to replay the pool motion right now.
 *
 * Only the stuck combination qualifies: the selection actually changed *and* the pool is the
 * motion playing without a cycle. Everything else re-reads the selection on its own — a cycling
 * pool on its next rotation, a covered pool when the motion above it finishes.
 */
export function shouldRestartIdle(
  previous: readonly string[] | null,
  next: readonly string[],
  current: ResolvedMotion | null,
  poolId: string,
): boolean {
  return poolSelectionChanged(previous, next) && needsRestartOnPoolChange(current, poolId);
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
  const variantFilter = opts?.variantFilter;

  /** Per-id cursor for sequential variant_policy. */
  const seqCursors = new Map<string, number>();

  /** Per-id prior selected path for random variant_policy — avoids repetition. Keyed by path,
   * not index, because a filtered pool changes what an index points at. */
  const lastRandomPath = new Map<string, string>();

  /** Currently playing (committed) motion. */
  let current: ResolvedMotion | null = null;
  /** Tracks ambient/state motion — return target after oneshot ends. */
  let previousStable: ResolvedMotion | null = null;
  /** Single-slot queue. */
  let queued: ResolvedMotion | null = null;

  function resolve(signal: RenderMotionSignal): ResolvedMotion | null {
    const entry = registry[signal.id];
    if (!entry) {
      warn(`[MotionController] unregistered motion id: "${signal.id}"`);
      return null;
    }

    // Select variant. The filter runs per resolve, so a user selection change lands on the next pick.
    let vrma_path = entry.vrma_path;
    let variants: readonly string[] | undefined = entry.variants;
    if (variants && variantFilter) variants = variantFilter(signal.id, variants);
    if (variants && variants.length > 0) {
      const policy = entry.variant_policy ?? "random";
      if (policy === "sequential") {
        // Modulo guards a cursor stored against a longer pool than the filter now yields.
        const cursor = (seqCursors.get(signal.id) ?? 0) % variants.length;
        vrma_path = variants[cursor]!;
        seqCursors.set(signal.id, (cursor + 1) % variants.length);
      } else {
        // random (default) — if same as the previous pick, shift by one to avoid repetition.
        let index = Math.min(variants.length - 1, Math.floor(rng() * variants.length));
        if (variants[index] === lastRandomPath.get(signal.id) && variants.length > 1) {
          index = (index + 1) % variants.length;
        }
        vrma_path = variants[index]!;
        lastRandomPath.set(signal.id, vrma_path);
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
      root_lock_y: !!entry.root_lock_y,
    };
  }

  function request(signal: RenderMotionSignal | null): MotionDecision {
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
    invalidatePool(id) {
      if (previousStable?.id === id) previousStable = null;
    },
  };
}
