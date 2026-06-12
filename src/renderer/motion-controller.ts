/**
 * MotionController — pure state machine for motion scheduling / variant resolution.
 * NO three.js import. No rendering side-effects.
 *
 * 책임: registry 조회 + variant 선택 + clamp/default 적용(resolve), interrupt
 * 정책에 따른 play/queue/ignore 결정(request), oneshot 종료 후 복귀(finish),
 * 단일 슬롯 queue/현재 모션 상태 보유(commit/current).
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
}

// ─────────────────────────────────────────────────────────────────────────────
// 상수
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
 * - rng: variant 선택용(주입 시 결정론적 테스트 가능), default Math.random.
 * - warn: 미등록 id / speed clamp 경고, default logger.warn.
 * - baselineId: request(null)/finish 복귀 대상, default "idle".
 */
export function createMotionController(
  registry: MotionRegistry,
  opts?: MotionControllerOptions,
): MotionController {
  const baselineId = opts?.baselineId ?? "idle";
  const rng = opts?.rng ?? Math.random;
  const warn = opts?.warn ?? ((msg: string) => log.warn(msg));

  /** sequential variant_policy용 per-id 커서. */
  const seqCursors = new Map<string, number>();

  /** random variant_policy용 per-id 직전 선택 index — 연속 반복 회피. */
  const lastRandomIndex = new Map<string, number>();

  /** 현재 재생 중(커밋된) 모션. */
  let current: ResolvedMotion | null = null;
  /** ambient/state 모션을 기록 — oneshot 종료 후 복귀 대상. */
  let previousStable: ResolvedMotion | null = null;
  /** 단일 슬롯 queue. */
  let queued: ResolvedMotion | null = null;

  function resolve(signal: MotionSignal): ResolvedMotion | null {
    const entry = registry[signal.id];
    if (!entry) {
      warn(`[MotionController] unregistered motion id: "${signal.id}"`);
      return null;
    }

    // variant 선택.
    let vrma_path = entry.vrma_path;
    const variants = entry.variants;
    if (variants && variants.length > 0) {
      const policy = entry.variant_policy ?? "random";
      if (policy === "sequential") {
        const cursor = seqCursors.get(signal.id) ?? 0;
        vrma_path = variants[cursor]!;
        seqCursors.set(signal.id, (cursor + 1) % variants.length);
      } else {
        // random (default) — 직전과 같은 index면 한 칸 밀어 연속 반복을 피한다.
        let index = Math.min(variants.length - 1, Math.floor(rng() * variants.length));
        const last = lastRandomIndex.get(signal.id);
        if (last === index && variants.length > 1) {
          index = (index + 1) % variants.length;
        }
        lastRandomIndex.set(signal.id, index);
        vrma_path = variants[index]!;
      }
    }

    // speed: signal override → clamp [0.25, 2.5], 범위 밖이면 warn 1회.
    let speed = signal.speed ?? 1;
    if (speed < SPEED_MIN || speed > SPEED_MAX) {
      warn(`[MotionController] speed ${speed} out of range [${SPEED_MIN}, ${SPEED_MAX}] — clamped`);
      speed = Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed));
    }

    // fade_ms: signal → entry default → 200, >= 0 (0 유효).
    const fade_ms = signal.fade_ms ?? entry.fade_ms ?? DEFAULT_FADE_MS;

    const loop = signal.loop ?? entry.loop;
    const cycle = loop && !!variants && variants.length > 1;

    return {
      id: signal.id,
      vrma_path,
      loop,
      cycle,
      speed,
      fade_ms,
      kind: entry.kind,
      priority: entry.priority,
      interrupt_policy: entry.interrupt_policy,
    };
  }

  function request(signal: MotionSignal | null): MotionDecision {
    // null → baseline 복귀.
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

    // incoming 우선순위가 더 낮음 → incoming의 interrupt_policy로 결정.
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

    // queue가 차 있으면 drain.
    if (queued) {
      const next = queued;
      queued = null;
      return { action: "play", motion: next };
    }

    // cycle 모션(idle 등)이면 같은 id를 재-resolve해 새 variant로 이어 붙인다.
    if (current.cycle) {
      const next = resolve({ id: current.id });
      if (next) return { action: "play", motion: next };
    }

    // 아니면 직전 안정 모션(ambient/state)으로, 없으면 baseline.
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
  };
}
