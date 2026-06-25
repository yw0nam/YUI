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

export interface EmotionCrossfadeDeps {
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
  /** 현재 VRM 기준 expression 존재 술어 (핫스왑마다 재계산). */
  let hasExpressionCache: ((k: string) => boolean) | undefined;
  /**
   * 진행 중 emotion 크로스페이드 상태(없으면 null).
   *  - prevKey: 페이드 아웃 중인 직전 표정 키(없으면 null).
   *  - prevWeightAtStart: 페이드 시작 시점의 prev weight(중간 retarget pop 방지).
   *  - targetKey/targetWeight: 페이드 인 목표 키/weight.
   *  - startTargetW: 페이드 시작 시점의 target weight(retarget 시 현재 blend에서 출발).
   *  - startMs/durationMs: 프레임 클록(elapsed*1000) 기준 시작/길이.
   *  - curPrevW/curTargetW: 현재 프레임 적용 weight(retarget 출발점으로 재사용).
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
   * 현재 VRM 기준 expression 존재 술어를 재계산하고 resolver를 재생성한다.
   * 존재 집합은 모델별이라 VRM 로드마다 새로 빌드해야 한다.
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
   * emotion 크로스페이드 한 프레임 진행 — mixer.update 후, vrm.update 직전 호출.
   * 매 프레임 target/prev weight를 수동 lerp(three-vrm 내장 보간 없음).
   * blink/blinkLeft/blinkRight/lookAt/mouth 키는 절대 건드리지 않는다(ambient/lipsync 소유).
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
        // prev 키를 1회 0으로 내리고 분리, target은 매 프레임 계속 고정(held).
        if (x.prevKey && x.prevKey !== x.targetKey) {
          em.setValue(x.prevKey, 0);
        }
        x.prevKey = null;
        x.curPrevW = 0;
        // target weight를 핀으로 고정 — 다음 프레임에도 계속 재적용된다.
        x.startTargetW = x.targetWeight;
        x.curTargetW = x.targetWeight;
      }
    } catch (err) {
      log.error("step_emotion", { error: String(err) });
    }
  }

  /** setEmotion 구현 — resolve → 현재 blend에서 retarget → 크로스페이드 시작. */
  function setEmotion(emotion: EmotionSignal | null): void {
    // "emotion 없으면 직전 표정 유지" — null은 NO-OP.
    // 오직 명시적 {id:"neutral"}만 neutral로 전이한다.
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
          // 진행 중 다른 target → 현재 blend된 target weight를 새 prev로(중간 retarget pop 방지).
          prevKey = emotionXfade.targetKey;
          prevWeightAtStart = emotionXfade.curTargetW;
        } else {
          // 같은 키 → prev 페이드는 그대로 이어가고 target weight/duration만 갱신.
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

  /** 직전 emotion을 명시적 neutral 전이로 천천히 되돌린다 (TTS 재생 종료 시). */
  function easeToNeutral(durationMs?: number): void {
    revertEmotionToNeutral(durationMs, { setEmotion });
  }

  function setRegistry(registry: EmotionRegistry): void {
    emotionRegistry = registry;
    // 현재 VRM 기준 존재 술어 재계산 + resolver 재생성.
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
