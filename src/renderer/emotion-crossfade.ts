/**
 * Emotion crossfade — the stateful VRM-expression apply layer over the pure
 * ./emotion-resolver math.
 *
 * Owns the in-flight crossfade state, the resolver, and the per-model
 * has-expression predicate. step() manually lerps target/prev expression weights
 * each frame (no three-vrm built-in interpolation); nothing else reads emotion
 * state except the frame gate, which reads isFading(). Never touches
 * blink/lookAt/mouth keys (ambient/lipsync own those).
 */

import type { VRM } from "@pixiv/three-vrm";
import type { EmotionRegistry, EmotionSignal } from "../contract";
import { revertEmotionToNeutral } from "./ease-emotion";
import {
  createEmotionResolver,
  type EmotionResolver,
  type ResolvedEmotion,
} from "./emotion-resolver";

/** Logger surface the emotion path needs (matches the renderer logger). */
interface EmotionLog {
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

interface EmotionCrossfadeDeps {
  /** The live VRM (or undefined) — read fresh each call; never cached across frames. */
  getVrm: () => VRM | undefined;
  /** Frame clock in ms (elapsed*1000) — read live so step/setEmotion share the same value. */
  getElapsedMs: () => number;
  /** Initial registry (configs/emotion_registry.json), if injected at construction. */
  registry?: EmotionRegistry;
  log: EmotionLog;
}

export interface EmotionCrossfade {
  /**
   * Advance one frame — call after mixer.update, before vrm.update, so the
   * weights land in this frame's expressionManager.update() (inside vrm.update).
   */
  step(dt: number): void;
  /** Resolve → retarget from the current blend → start the crossfade. null is a NO-OP. */
  setEmotion(emotion: EmotionSignal | null): void;
  /** Slowly ease the prior emotion back to neutral via an explicit neutral transition. */
  easeToNeutral(durationMs?: number): void;
  /** Inject/replace the registry, then recompute the has-expression predicate + resolver. */
  setRegistry(registry: EmotionRegistry): void;
  /**
   * VRM load hook — recomputes the per-model predicate + resolver, but only when a
   * registry is present (matches the original `if (emotionRegistry) recompute()` gate;
   * with no registry the predicate is left untouched, exactly as before).
   */
  onVrmLoaded(): void;
  /** Drop the in-flight crossfade (hotswap/dispose) so it can't write to a disposed VRM. */
  reset(): void;
  /** True while a crossfade is in flight — gates the idle frame cap. */
  isFading(): boolean;
}

export function createEmotionCrossfade(deps: EmotionCrossfadeDeps): EmotionCrossfade {
  const { getVrm, getElapsedMs, log } = deps;

  let emotionRegistry: EmotionRegistry | undefined = deps.registry;
  let emotionResolver: EmotionResolver | undefined;
  /** Expression existence predicate for the current VRM (recomputed on each hotswap). */
  let hasExpressionCache: ((k: string) => boolean) | undefined;
  /**
   * In-flight emotion crossfade state (null if none).
   *  - prevKey: prior expression key fading out (null if none).
   *  - prevWeightAtStart: prev weight at fade start (prevents mid-retarget pop).
   *  - targetKey/targetWeight: fade-in target key/weight.
   *  - startTargetW: target weight at fade start (starts from current blend on retarget).
   *  - startMs/durationMs: frame clock (elapsed*1000) basis — start and duration.
   *  - curPrevW/curTargetW: current frame applied weight (reused as retarget starting point).
   */
  let emotionXfade: {
    prevKey: string | null;
    prevWeightAtStart: number;
    targetKey: string;
    targetWeight: number;
    startTargetW: number;
    startMs: number;
    durationMs: number;
    curPrevW: number;
    curTargetW: number;
  } | null = null;

  const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

  /**
   * Recomputes the expression existence predicate for the current VRM and regenerates the resolver.
   * The existence set is per-model so it must be rebuilt on each VRM load.
   */
  function recompute(): void {
    const currentVrm = getVrm();
    hasExpressionCache = (k: string): boolean =>
      currentVrm?.expressionManager?.getExpression(k) != null;
    if (emotionRegistry) {
      emotionResolver = createEmotionResolver(emotionRegistry, {
        hasExpression: hasExpressionCache,
      });
    }
  }

  /**
   * Advance emotion crossfade one frame — called after mixer.update, before vrm.update.
   * Manually lerps target/prev weight each frame (no three-vrm built-in interpolation).
   * Never touches blink/blinkLeft/blinkRight/lookAt/mouth keys (owned by ambient/lipsync).
   */
  function step(_dt: number): void {
    const currentVrm = getVrm();
    if (!emotionXfade || !currentVrm) return;
    const em = currentVrm.expressionManager;
    if (!em) return;
    try {
      const x = emotionXfade;
      const now = getElapsedMs();
      const t = clamp01((now - x.startMs) / Math.max(1, x.durationMs));
      x.curTargetW = lerp(x.startTargetW, x.targetWeight, t);
      x.curPrevW = lerp(x.prevWeightAtStart, 0, t);

      em.setValue(x.targetKey, x.curTargetW);
      if (x.prevKey && x.prevKey !== x.targetKey) {
        em.setValue(x.prevKey, x.curPrevW);
      }

      if (t >= 1) {
        // Drop prev key to 0 once and detach; target continues to be held every frame.
        if (x.prevKey && x.prevKey !== x.targetKey) {
          em.setValue(x.prevKey, 0);
        }
        x.prevKey = null;
        x.curPrevW = 0;
        // Pin target weight — continues to be reapplied in subsequent frames.
        x.startTargetW = x.targetWeight;
        x.curTargetW = x.targetWeight;
      }
    } catch (err) {
      log.error("step_emotion", { error: String(err) });
    }
  }

  /** setEmotion implementation — resolve → retarget from current blend → start crossfade. */
  function setEmotion(emotion: EmotionSignal | null): void {
    // "If no emotion, retain prior expression" — null is a NO-OP.
    // Only explicit {id:"neutral"} transitions to neutral.
    if (emotion === null) return;

    if (!emotionResolver || !emotionRegistry) {
      log.warn("set_emotion_no_registry");
      return;
    }
    if (!getVrm()) return;

    try {
      const resolved: ResolvedEmotion = emotionResolver.resolve(emotion);
      const now = getElapsedMs();

      let prevKey: string | null = null;
      let prevWeightAtStart = 0;

      if (emotionXfade) {
        if (emotionXfade.targetKey !== resolved.vrm_expression) {
          // Different target in flight → use current blended target weight as new prev (prevents mid-retarget pop).
          prevKey = emotionXfade.targetKey;
          prevWeightAtStart = emotionXfade.curTargetW;
        } else {
          // Same key → continue prev fade as-is; only update target weight/duration.
          prevKey = emotionXfade.prevKey;
          prevWeightAtStart = emotionXfade.curPrevW;
        }
      }

      const startTargetW =
        emotionXfade && emotionXfade.targetKey === resolved.vrm_expression
          ? emotionXfade.curTargetW
          : 0;

      emotionXfade = {
        prevKey,
        prevWeightAtStart,
        targetKey: resolved.vrm_expression,
        targetWeight: resolved.intensity,
        startTargetW,
        startMs: now,
        durationMs: resolved.transition_ms,
        curPrevW: prevWeightAtStart,
        curTargetW: startTargetW,
      };
    } catch (err) {
      log.error("set_emotion", { error: String(err) });
    }
  }

  /** Slowly ease the prior emotion back to neutral via explicit neutral transition (on TTS playback end). */
  function easeToNeutral(durationMs?: number): void {
    revertEmotionToNeutral(durationMs, { setEmotion });
  }

  function setRegistry(registry: EmotionRegistry): void {
    emotionRegistry = registry;
    // Recompute existence predicate for current VRM + regenerate resolver.
    recompute();
  }

  return {
    step,
    setEmotion,
    easeToNeutral,
    setRegistry,
    onVrmLoaded() {
      // Original gate: recompute only when a registry is present.
      if (emotionRegistry) recompute();
    },
    reset() {
      emotionXfade = null;
    },
    isFading() {
      return emotionXfade !== null;
    },
  };
}
