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
  /** 미등록 id / intensity clamp 경고. default console.warn */
  warn?: (m: string) => void;
}

export interface EmotionResolver {
  /** 항상 non-null — 미등록 / fallback 전부 실패 시에도 neutral 반환. */
  resolve(signal: EmotionSignal): ResolvedEmotion;
}

// ─────────────────────────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_INTENSITY = 1;
const DEFAULT_TRANSITION_MS = 250;
const FALLBACK_EXPRESSION = "neutral";

// ─────────────────────────────────────────────────────────────────────────────
// Factory (stub — placeholder values so build passes; assertions will fail)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates an EmotionResolver backed by the given registry.
 *
 * - hasExpression: VRM 모델 expression 존재 확인용(주입 시 결정론적 테스트 가능),
 *   default () => true (모든 expression 존재로 간주).
 * - warn: 미등록 id / intensity clamp 경고, default console.warn.
 */
export function createEmotionResolver(
  registry: EmotionRegistry,
  opts?: EmotionResolverOptions,
): EmotionResolver {
  const _hasExpression = opts?.hasExpression ?? (() => true);
  const _warn = opts?.warn ?? ((m: string) => console.warn(m));

  // Suppress unused-variable warnings in stub — real impl will use these.
  void registry;
  void _hasExpression;
  void _warn;

  return {
    resolve(signal: EmotionSignal): ResolvedEmotion {
      return {
        id: signal.id,
        vrm_expression: FALLBACK_EXPRESSION,
        intensity: DEFAULT_INTENSITY,
        transition_ms: DEFAULT_TRANSITION_MS,
      };
    },
  };
}
