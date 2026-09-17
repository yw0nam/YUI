/**
 * Amplitude-only mouth lip-sync + expression observability.
 *
 * Pure of any renderer closure state: the `aa` mouth state machine and the
 * expression-describe helper. Re-exported from ./index to keep the public surface intact.
 */

/** VRM mouth-open preset driven exclusively by lip sync (never emotion/ambient). */
export const MOUTH_EXPRESSION_KEY = "aa" as const;

/**
 * Inspect an expressionManager's expressionMap: list available expression keys
 * and report whether the lipsync mouth key is present. Observability only — lets
 * logs answer "audio played but the mouth didn't move — why?".
 */
export function describeExpressions(
  em: { expressionMap?: Record<string, unknown> } | null | undefined,
): { expressions: string[]; hasMouth: boolean } {
  const map = em?.expressionMap;
  const expressions = map ? Object.keys(map) : [];
  return { expressions, hasMouth: expressions.includes(MOUTH_EXPRESSION_KEY) };
}

/** Minimal expressionManager surface the mouth state machine needs. */
interface MouthExpressionManager {
  setValue(name: string, weight: number): void;
  getExpression(name: string): unknown;
}

export interface MouthLipsyncOptions {
  /** Per-step lerp factor toward the target weight (0..1; 1 = snap). */
  smoothing?: number;
}

/** Amplitude-only mouth state machine: target in [0,1], lerped, writes only `aa`. */
export interface MouthLipsync {
  /** Set the desired mouth-open target, clamped to [0,1]. */
  setOpen(value: number): void;
  /** Advance one frame: lerp current toward target, write the `aa` weight. */
  step(dt: number, em: MouthExpressionManager): void;
  /** Ease the mouth back to 0 (closed). */
  stop(): void;
  /** Current applied mouth-open weight (0..1) — cheap read for the frame gate. */
  openValue(): number;
}

/**
 * Pure amplitude lip-sync mouth driver (no viseme).
 * Owns ONLY the `aa` preset; never touches blink/lookAt/emotion keys.
 * No-ops when the model lacks `aa`. Frame-rate handling is the caller's dt.
 */
export function createMouthLipsync(options: MouthLipsyncOptions = {}): MouthLipsync {
  const smoothing = Math.min(1, Math.max(0, options.smoothing ?? 0.4));
  let target = 0;
  let current = 0;

  return {
    setOpen(value) {
      target = Math.min(1, Math.max(0, value));
    },
    step(_dt, em) {
      if (em.getExpression(MOUTH_EXPRESSION_KEY) == null) return;
      current += (target - current) * smoothing;
      em.setValue(MOUTH_EXPRESSION_KEY, current);
    },
    stop() {
      target = 0;
    },
    openValue() {
      return current;
    },
  };
}
