/**
 * EmotionResolver — determines VRM expression + traverses fallback chain.
 * NO three.js import. No rendering side-effects.
 *
 * Responsibility: registry lookup + check hasExpression existence + traverse fallback chain +
 * apply intensity clamp/default (resolve). Always returns non-null ResolvedEmotion —
 * all cases including unregistered ids resolve to final fallback "neutral".
 *
 * Exported surface (contract):
 *   createEmotionResolver(registry, opts?) → EmotionResolver
 *
 * Constants (see implementation):
 *   INTENSITY_MIN = 0, INTENSITY_MAX = 1
 *   DEFAULT_INTENSITY = 1, DEFAULT_TRANSITION_MS = 250
 *   FALLBACK_EXPRESSION = "neutral"
 */

import type { EmotionId, EmotionRegistry, EmotionSignal } from "../contract";
import { createLogger } from "../logger";

const log = createLogger("emotion-resolver");

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface ResolvedEmotion {
  id: EmotionId;
  /** VRM expression key from hasExpression chain traversal. */
  vrm_expression: string;
  /** clamped to [0, 1] */
  intensity: number;
  /** >= 0, default 250 */
  transition_ms: number;
}

interface EmotionResolverOptions {
  /** Checks if the given expression key exists in the VRM model. Default: () => true */
  hasExpression?: (key: string) => boolean;
  /** Warns on unregistered id / intensity clamp. Default: logger.warn */
  warn?: (m: string) => void;
}

export interface EmotionResolver {
  /** Always non-null — returns neutral even if unregistered / all fallbacks fail. */
  resolve(signal: EmotionSignal): ResolvedEmotion;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const INTENSITY_MIN = 0;
const INTENSITY_MAX = 1;
const DEFAULT_INTENSITY = 1;
const DEFAULT_TRANSITION_MS = 250;
const FALLBACK_EXPRESSION = "neutral";

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates an EmotionResolver backed by the given registry.
 *
 * - hasExpression: checks VRM model expression existence (enables deterministic tests when injected),
 *   default () => true (assumes all expressions exist ⇒ first key adopted immediately, no walk).
 * - warn: warns on unregistered id / intensity clamp; default logger.warn.
 */
export function createEmotionResolver(
  registry: EmotionRegistry,
  opts?: EmotionResolverOptions,
): EmotionResolver {
  const hasExpression = opts?.hasExpression ?? (() => true);
  const warn = opts?.warn ?? ((m: string) => log.warn(m));

  /**
   * Existence-aware fallback chain traversal.
   * - Starts from registry id → if entry.vrm_expression key exists, adopt it.
   * - Otherwise follows entry.fallback: if fallback is a registry id, recurse into that entry's chain;
   *   otherwise treat as literal expression key and check hasExpression.
   * - Cycle guard via visited Set (tracks both registry ids and keys).
   * - When chain exhausts/cycles, return final fallback "neutral" (regardless of existence).
   */
  function walk(id: string, visited: Set<string>): string {
    if (visited.has(id)) return FALLBACK_EXPRESSION;
    visited.add(id);

    const entry = registry[id as EmotionId];
    if (!entry) {
      // id not in registry → treat as literal expression key.
      return hasExpression(id) ? id : FALLBACK_EXPRESSION;
    }

    // Always check entry's own vrm_expression key (even if id==key homonymous).
    const key = entry.vrm_expression;
    if (hasExpression(key)) return key;

    const fb = entry.fallback;
    if (fb == null) return FALLBACK_EXPRESSION;

    if (registry[fb as EmotionId]) {
      // fallback is a registry id → recurse into that entry's chain.
      return walk(fb, visited);
    }
    // Treat as literal expression key.
    if (visited.has(fb)) return FALLBACK_EXPRESSION;
    visited.add(fb);
    return hasExpression(fb) ? fb : FALLBACK_EXPRESSION;
  }

  return {
    resolve(signal: EmotionSignal): ResolvedEmotion {
      // intensity: default 1, clamp to [0,1] after warning once if out of range.
      let intensity = signal.intensity ?? DEFAULT_INTENSITY;
      if (intensity < INTENSITY_MIN || intensity > INTENSITY_MAX) {
        warn(
          `[EmotionResolver] intensity ${intensity} out of range [${INTENSITY_MIN}, ${INTENSITY_MAX}] — clamped`,
        );
        intensity = Math.min(INTENSITY_MAX, Math.max(INTENSITY_MIN, intensity));
      }

      // transition_ms: default 250, 0 is valid, negative values clamp to 0.
      let transition_ms = signal.transition_ms ?? DEFAULT_TRANSITION_MS;
      if (transition_ms < 0) transition_ms = 0;

      // Unregistered id → warn once, then use neutral.
      const entry = registry[signal.id];
      if (!entry) {
        warn(`[EmotionResolver] unregistered emotion id: "${signal.id}"`);
        return {
          id: signal.id,
          vrm_expression: FALLBACK_EXPRESSION,
          intensity,
          transition_ms,
        };
      }

      const vrm_expression = walk(signal.id, new Set<string>());
      return { id: signal.id, vrm_expression, intensity, transition_ms };
    },
  };
}
