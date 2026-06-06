/**
 * EmotionResolver — VRM expression 결정 + fallback chain 탐색.
 * NO three.js import. No rendering side-effects.
 *
 * 책임: registry 조회 + hasExpression 존재 여부 확인 + fallback 체인 탐색 +
 * intensity clamp/default 적용(resolve). 항상 non-null ResolvedEmotion 반환 —
 * 미등록 id 포함 모든 경우 최종 fallback "neutral"로 귀결.
 *
 * Exported surface (contract):
 *   createEmotionResolver(registry, opts?) → EmotionResolver
 *
 * 상수(실 구현 참고):
 *   INTENSITY_MIN = 0, INTENSITY_MAX = 1
 *   DEFAULT_INTENSITY = 1, DEFAULT_TRANSITION_MS = 250
 *   FALLBACK_EXPRESSION = "neutral"
 */

import type { EmotionId, EmotionSignal, EmotionRegistry } from "../contract";
import { createLogger } from "../logger";

const log = createLogger("emotion-resolver");

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface ResolvedEmotion {
  id: EmotionId;
  /** hasExpression 체인 탐색 결과 VRM expression 키 */
  vrm_expression: string;
  /** clamped to [0, 1] */
  intensity: number;
  /** >= 0, default 250 */
  transition_ms: number;
}

export interface EmotionResolverOptions {
  /** VRM 모델에 해당 expression 키가 존재하는지 확인. default: () => true */
  hasExpression?: (key: string) => boolean;
  /** 미등록 id / intensity clamp 경고. default logger.warn */
  warn?: (m: string) => void;
}

export interface EmotionResolver {
  /** 항상 non-null — 미등록 / fallback 전부 실패 시에도 neutral 반환. */
  resolve(signal: EmotionSignal): ResolvedEmotion;
}

// ─────────────────────────────────────────────────────────────────────────────
// 상수
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
 * - hasExpression: VRM 모델 expression 존재 확인용(주입 시 결정론적 테스트 가능),
 *   default () => true (모든 expression 존재로 간주 ⇒ 첫 키가 즉시 채택, walk 없음).
 * - warn: 미등록 id / intensity clamp 경고, default logger.warn.
 */
export function createEmotionResolver(
  registry: EmotionRegistry,
  opts?: EmotionResolverOptions,
): EmotionResolver {
  const hasExpression = opts?.hasExpression ?? (() => true);
  const warn = opts?.warn ?? ((m: string) => log.warn(m));

  /**
   * 존재 인지(existence-aware) fallback 체인 탐색.
   * - registry id에서 출발 → entry.vrm_expression 키가 존재하면 그 키 채택.
   * - 없으면 entry.fallback을 따라간다: fallback이 registry id면 그 entry 체인으로
   *   재귀, 아니면 literal expression 키로 간주해 hasExpression 검사.
   * - visited Set(registry id + key 둘 다 기록)으로 사이클 가드.
   * - 체인이 소진/순환하면 최종 fallback "neutral" 반환(존재 여부 무관).
   */
  function walk(id: string, visited: Set<string>): string {
    if (visited.has(id)) return FALLBACK_EXPRESSION;
    visited.add(id);

    const entry = registry[id as EmotionId];
    if (!entry) {
      // id가 registry에 없음 → literal expression 키로 간주.
      return hasExpression(id) ? id : FALLBACK_EXPRESSION;
    }

    // entry 자신의 vrm_expression 키는 항상 검사(id==key 동명이라도).
    const key = entry.vrm_expression;
    if (hasExpression(key)) return key;

    const fb = entry.fallback;
    if (fb == null) return FALLBACK_EXPRESSION;

    if (registry[fb as EmotionId]) {
      // fallback이 registry id → 그 entry 체인으로 재귀.
      return walk(fb, visited);
    }
    // literal expression 키.
    if (visited.has(fb)) return FALLBACK_EXPRESSION;
    visited.add(fb);
    return hasExpression(fb) ? fb : FALLBACK_EXPRESSION;
  }

  return {
    resolve(signal: EmotionSignal): ResolvedEmotion {
      // intensity: default 1, 범위 밖이면 warn 1회 후 [0,1] clamp.
      let intensity = signal.intensity ?? DEFAULT_INTENSITY;
      if (intensity < INTENSITY_MIN || intensity > INTENSITY_MAX) {
        warn(
          `[EmotionResolver] intensity ${intensity} out of range [${INTENSITY_MIN}, ${INTENSITY_MAX}] — clamped`,
        );
        intensity = Math.min(INTENSITY_MAX, Math.max(INTENSITY_MIN, intensity));
      }

      // transition_ms: default 250, 0 유효, 음수는 0으로 clamp.
      let transition_ms = signal.transition_ms ?? DEFAULT_TRANSITION_MS;
      if (transition_ms < 0) transition_ms = 0;

      // 미등록 id → warn 1회 후 neutral.
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
