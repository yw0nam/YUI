/**
 * Renderer — three.js + @pixiv/three-vrm 출력 레이어. (PRD F1 / concept.md §2.A)
 *
 * 현재 구현 범위 = #4 VRM 로드 + 핫스왑:
 *  - three.js scene/camera/light + rAF 루프 (vrm.update).
 *  - VRMLoaderPlugin으로 VRM 로드, VRMUtils 최적화, 투명 배경(펫 창 #7).
 *  - loadVRM 재호출 = 핫스왑 (기존 모델 deepDispose 후 교체).
 *
 * applyDirective(#16a render-wiring): ControlEnvelope의 emotion/motion 채널을 setEmotion(#6)/
 *   playMotion(#5)로 라우팅(contract §3). 순수 dispatch는 ./apply-directive. TTS-prefix(#16b) 미구현.
 *
 * 미구현(별 이슈):
 *  - Tier1 ambient blend(#10), 립싱크(#15), applyDirective TTS-prefix half(#16b / #23 보류).
 *
 * 근거: three-vrm 3.x 공식 예제(GLTFLoader.register(VRMLoaderPlugin) → gltf.userData.vrm,
 *       VRMUtils.removeUnnecessaryVertices/combineSkeletons/combineMorphs, deepDispose).
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import {
  VRMAnimationLoaderPlugin,
  createVRMAnimationClip,
} from "@pixiv/three-vrm-animation";
import type {
  ControlEnvelope,
  EmotionSignal,
  EmotionRegistry,
  MotionSignal,
  MotionRegistry,
} from "../contract";
import {
  createMotionController,
  type MotionController,
  type ResolvedMotion,
} from "./motion-controller";
import {
  createEmotionResolver,
  type EmotionResolver,
  type ResolvedEmotion,
} from "./emotion-resolver";
import { routeDirective } from "./apply-directive";
import { recenterClipRootMotion } from "./recenter-root-motion";

export interface RendererOptions {
  /** VRM을 렌더할 캔버스 마운트 대상. */
  mount: HTMLElement;
  /**
   * motion registry (configs/motions.json). 주입하면 playMotion이 동작한다.
   * 없으면 playMotion은 warn 후 no-op (#4 단독 동작 유지). setMotionRegistry로 나중에 주입 가능.
   */
  motionRegistry?: MotionRegistry;
  /**
   * emotion registry (configs/emotion_registry.json). 주입하면 setEmotion이 동작한다.
   * 없으면 setEmotion은 warn 후 no-op. setEmotionRegistry로 나중에 주입 가능.
   */
  emotionRegistry?: EmotionRegistry;
}

/** rAF 프레임마다, **vrm.update(dt) 직전에** 전달되는 컨텍스트. */
export interface TickContext {
  /** 현재 로드된 VRM (훅은 vrm이 있을 때만 호출됨). */
  readonly vrm: VRM;
  /** 직전 프레임과의 시간차(초). */
  readonly dt: number;
  /** 첫 프레임 이후 누적 경과 시간(초). */
  readonly elapsed: number;
}

/** 프레임 훅. bone/expression 변경은 여기서(=vrm.update 전) 해야 spring bone에 반영된다. */
export type TickFn = (ctx: TickContext) => void;

export interface Renderer {
  /** VRM 로드 또는 핫스왑 (#4). 기존 모델이 있으면 새 모델 준비 후 dispose하고 교체. */
  loadVRM(url: string): Promise<void>;
  /**
   * 프레임 훅 등록 (#10 ambient 등). vrm.update(dt) **직전에** 호출되며,
   * currentVrm이 있을 때만 발화한다. 등록 해제 함수를 반환.
   */
  onTick(fn: TickFn): () => void;
  /**
   * contract.md §3 렌더 규약대로 render directive 적용 (#16a render-wiring half).
   * emotion → setEmotion(#6) (present만, 없으면 hold/no-op), motion → playMotion(#5)
   * (없거나 null이면 idle 복귀). 순수 라우팅은 ./apply-directive routeDirective가 담당.
   * TTS-prefix half(#16b / D-EMOTION-DUAL)는 미구현(#23 보류).
   */
  applyDirective(env: ControlEnvelope): void;
  /**
   * emotion → expression GPU 크로스페이드 전이 (#6).
   * registry가 주입돼 있고 VRM이 로드된 경우에만 동작.
   * emotion === null이면 NO-OP(직전 표정 유지). neutral 복귀는 명시적 {id:"neutral"}만.
   */
  setEmotion(emotion: EmotionSignal | null): void;
  /**
   * emotion registry 주입(또는 교체). 주입 시 현재 VRM 기준 hasExpression 술어를
   * 재계산하고 EmotionResolver를 (재)생성한다.
   */
  setEmotionRegistry(registry: EmotionRegistry): void;
  /**
   * 립싱크 입 벌림 목표 설정 (#15, PRD D1 amplitude-only). value는 [0,1]로 clamp되며
   * 매 프레임 `aa` 프리셋으로 부드럽게(lerp) 반영된다. blink/lookAt/emotion 키는 건드리지 않는다.
   */
  setMouthOpen(value: number): void;
  /** 립싱크 정지 — 입을 0(닫힘)으로 ease한다. */
  stopMouth(): void;
  /** motion registry 조회 후 VRMA 재생 (#5). registry가 주입돼 있어야 동작. */
  playMotion(motion: MotionSignal | null): void;
  /**
   * motion registry 주입(또는 교체). 주입 시 MotionController를 (재)생성하고,
   * VRM이 이미 로드돼 있으면 idle baseline을 재생한다.
   */
  setMotionRegistry(registry: MotionRegistry): void;
  /** rAF 루프 정지 + GPU 리소스 해제. */
  dispose(): void;
}

/** VRM mouth-open preset driven exclusively by lip sync (never emotion/ambient). */
export const MOUTH_EXPRESSION_KEY = "aa" as const;

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
}

/**
 * Pure amplitude lip-sync mouth driver (#15, PRD D1 — no viseme).
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
  };
}

export function createRenderer(options: RendererOptions): Renderer {
  const { mount } = options;

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x000000, 0); // 투명 배경 — 펫 창(#7)에서 캐릭터만 보이게.
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();

  // 펫 상반신 프레이밍: 살짝 위에서 정면.
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  camera.position.set(0, 1.3, 1.6);
  camera.lookAt(new THREE.Vector3(0, 1.3, 0));

  const dir = new THREE.DirectionalLight(0xffffff, Math.PI);
  dir.position.set(1, 1, 1).normalize();
  scene.add(dir);
  scene.add(new THREE.AmbientLight(0xffffff, Math.PI * 0.3));

  // GLTFLoader는 VRM/VRMA 둘 다 로드 (three-vrm-animation 공식 예제).
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
  let currentVrm: VRM | undefined;

  // ── Motion playback 상태 (#5) ──────────────────────────────────────────────
  let motionRegistry: MotionRegistry | undefined = options.motionRegistry;
  let controller: MotionController | undefined = motionRegistry
    ? createMotionController(motionRegistry)
    : undefined;
  /** 현재 VRM 전용 AnimationMixer (핫스왑마다 재생성). */
  let mixer: THREE.AnimationMixer | undefined;
  /** (vrma_path → AnimationClip) 캐시 — clip은 VRM 전용이라 핫스왑 시 비운다. */
  const clipCache = new Map<string, THREE.AnimationClip>();
  /** 현재 재생 중인 AnimationAction (crossfade의 prev). */
  let currentAction: THREE.AnimationAction | undefined;
  /** mixer "finished" 이벤트 → AnimationAction → 모션 id 역참조. */
  const actionToId = new Map<THREE.AnimationAction, string>();
  /** 핫스왑 race guard: 로드 비동기 사이에 VRM이 바뀌면 폐기. */
  let vrmEpoch = 0;

  // ── Lipsync 상태 (#15) ──────────────────────────────────────────────────────
  // 입(`aa`)은 lipsync 전용 — ambient/emotion와 분리. emotion crossfade와 같은
  // update 경로(vrm.update 직전)에서 매 프레임 lerp 반영한다.
  const mouth = createMouthLipsync();

  // ── Emotion 상태 (#6) ──────────────────────────────────────────────────────
  let emotionRegistry: EmotionRegistry | undefined = options.emotionRegistry;
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
  let emotionXfade:
    | {
        prevKey: string | null;
        prevWeightAtStart: number;
        targetKey: string;
        targetWeight: number;
        startTargetW: number;
        startMs: number;
        durationMs: number;
        curPrevW: number;
        curTargetW: number;
      }
    | null = null;

  /** mixer "finished" 핸들러 (oneshot 종료 → controller.finish → 복귀 재생). */
  const onMixerFinished = (e: { action: THREE.AnimationAction }): void => {
    try {
      const id = actionToId.get(e.action);
      actionToId.delete(e.action);
      if (!controller || !id) return;
      const decision = controller.finish(id);
      controller.commit(decision);
      if (decision.action === "play") {
        void startMotion(decision.motion);
      }
    } catch (err) {
      console.error("[YUI] motion finish handler error:", err);
    }
  };

  function resize(): void {
    const w = mount.clientWidth || 1;
    const h = mount.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(mount);

  const tickHooks = new Set<TickFn>();
  const clock = new THREE.Clock();
  let elapsed = 0;
  let rafId = 0;
  function animate(): void {
    rafId = requestAnimationFrame(animate);
    const dt = clock.getDelta();
    if (currentVrm) {
      elapsed += dt;
      // 훅을 먼저 — bone/expression 변경이 이번 프레임 vrm.update(spring/expression apply)에 반영되도록.
      if (tickHooks.size > 0) {
        const ctx: TickContext = { vrm: currentVrm, dt, elapsed };
        for (const fn of tickHooks) {
          try {
            fn(ctx);
          } catch (err) {
            console.error("[YUI] tick hook error:", err);
          }
        }
      }
      // mixer 먼저 — bone 갱신 후 vrm.update가 spring/expression을 apply.
      if (mixer) {
        try {
          mixer.update(dt);
        } catch (err) {
          console.error("[YUI] mixer update error:", err);
        }
      }
      // emotion 크로스페이드 — expressionManager.update()는 vrm.update(dt) 안에서
      // 돌므로 weight를 그 직전에 써야 이번 프레임에 반영된다.
      stepEmotion(dt);
      // lipsync — emotion과 같은 이유로 vrm.update 직전에 `aa` weight를 쓴다.
      if (currentVrm.expressionManager) {
        mouth.step(dt, currentVrm.expressionManager);
      }
      currentVrm.update(dt);
    }
    renderer.render(scene, camera);
  }
  animate();

  /** mixer/clip/action 캐시 + controller 상태를 모두 폐기 (핫스왑/dispose 공용). */
  function teardownMotion(): void {
    if (mixer) {
      mixer.removeEventListener("finished", onMixerFinished as never);
      mixer.stopAllAction();
      if (currentVrm) mixer.uncacheRoot(currentVrm.scene);
      mixer = undefined;
    }
    clipCache.clear();
    actionToId.clear();
    currentAction = undefined;
    // controller는 단순 no-op reset 수단이 없으므로 재생성해 current/queue를 비운다.
    // (clip은 VRM-specific이라 어차피 새 VRM에서 idle baseline을 다시 깔아야 한다.)
    if (motionRegistry) controller = createMotionController(motionRegistry);
  }

  function disposeCurrent(): void {
    if (!currentVrm) return;
    teardownMotion();
    // 진행 중 페이드가 폐기된 VRM에 쓰지 않도록 리셋(핫스왑/dispose 공용).
    emotionXfade = null;
    scene.remove(currentVrm.scene);
    VRMUtils.deepDispose(currentVrm.scene);
    currentVrm = undefined;
  }

  /**
   * vrma_path → AnimationClip (현재 VRM 전용). 캐시 적중 시 즉시 반환.
   * GLTFLoader + VRMAnimationLoaderPlugin로 .vrma 로드 → gltf.userData.vrmAnimations[0]
   * → createVRMAnimationClip(vrmAnimation, currentVrm) (three-vrm-animation 공식 경로).
   */
  async function loadClip(vrmaPath: string): Promise<THREE.AnimationClip | null> {
    const cached = clipCache.get(vrmaPath);
    if (cached) return cached;
    if (!currentVrm) return null;

    const epoch = vrmEpoch;
    const gltf = await loader.loadAsync(vrmaPath);
    // 로드 도중 핫스왑이 일어났으면 폐기.
    if (epoch !== vrmEpoch || !currentVrm) return null;

    const vrmAnimations = gltf.userData.vrmAnimations as unknown[] | undefined;
    const vrmAnimation = vrmAnimations?.[0];
    if (vrmAnimation == null) {
      console.error(`[YUI] no vrmAnimations in "${vrmaPath}"`);
      return null;
    }
    const clip = createVRMAnimationClip(vrmAnimation as never, currentVrm);
    recenterClipRootMotion(clip); // strip baked horizontal root drift so the pet stays centered.
    clipCache.set(vrmaPath, clip);
    return clip;
  }

  /**
   * resolve된 모션을 실제 재생 (clip 로드 → action 구성 → crossfade).
   * controller.commit은 호출자(playMotion/finish)가 결정과 함께 수행한다.
   */
  async function startMotion(motion: ResolvedMotion): Promise<void> {
    if (!currentVrm || !mixer) return;
    const epoch = vrmEpoch;
    try {
      const clip = await loadClip(motion.vrma_path);
      if (!clip || !mixer || epoch !== vrmEpoch) return;

      const action = mixer.clipAction(clip);
      action.timeScale = motion.speed;
      if (motion.loop) {
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.clampWhenFinished = false;
      } else {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        // oneshot 종료 추적용 역참조.
        actionToId.set(action, motion.id);
      }

      const fade = Math.max(0, motion.fade_ms) / 1000;
      const prev = currentAction;
      action.reset();
      action.enabled = true;
      if (prev && prev !== action && fade > 0) {
        action.crossFadeFrom(prev, fade, false).play();
      } else {
        if (prev && prev !== action) prev.stop();
        if (fade > 0) action.fadeIn(fade);
        action.play();
      }
      currentAction = action;
    } catch (err) {
      console.error("[YUI] startMotion error:", err);
    }
  }

  /** registry가 있으면 idle baseline을 깔아 항상 ambient가 돌게 한다. */
  function playIdleBaseline(): void {
    if (controller) playMotion({ id: "idle" });
  }

  // ── Emotion crossfade ──────────────────────────────────────────────────────

  const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

  /**
   * 현재 VRM 기준 expression 존재 술어를 재계산하고 resolver를 재생성한다.
   * 존재 집합은 모델별이라 VRM 로드마다 새로 빌드해야 한다.
   */
  function recomputeHasExpression(): void {
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
  function stepEmotion(_dt: number): void {
    if (!emotionXfade || !currentVrm) return;
    const em = currentVrm.expressionManager;
    if (!em) return;
    try {
      const x = emotionXfade;
      const now = elapsed * 1000;
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
      console.error("[YUI] stepEmotion error:", err);
    }
  }

  async function loadVRM(url: string): Promise<void> {
    const gltf = await loader.loadAsync(url);
    const vrm = gltf.userData.vrm as VRM;
    // 성능 최적화 (three-vrm 공식 권장).
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
    VRMUtils.combineMorphs(vrm);
    vrm.scene.traverse((obj) => {
      obj.frustumCulled = false;
    });
    VRMUtils.rotateVRM0(vrm); // VRM0.0이면 +Z 정면으로 회전, 1.0은 no-op.

    disposeCurrent(); // 핫스왑: 새 모델을 다 준비한 뒤 직전 모델 해제.
    vrmEpoch += 1; // 직전 모델에 묶인 비동기 clip 로드 무효화.
    currentVrm = vrm;
    scene.add(vrm.scene);

    // emotion: 존재 집합은 모델별이라 핫스왑마다 술어/resolver 재생성.
    if (emotionRegistry) recomputeHasExpression();

    // 새 VRM 전용 mixer (clip은 VRM-specific이므로 함께 새로 시작).
    mixer = new THREE.AnimationMixer(vrm.scene);
    mixer.addEventListener("finished", onMixerFinished as never);

    playIdleBaseline(); // registry가 있으면 idle ambient를 자동 재생.
  }

  /** playMotion 구현 — request → (play/queue/ignore) → commit + 실제 재생. */
  function playMotion(motion: MotionSignal | null): void {
    if (!controller) {
      console.warn("[YUI] playMotion called without a motion registry — no-op");
      return;
    }
    if (!currentVrm || !mixer) return; // VRM 미로드 시 재생 불가.
    try {
      const decision = controller.request(motion);
      controller.commit(decision);
      if (decision.action === "play") {
        void startMotion(decision.motion);
      }
      // "queue"는 commit으로 슬롯에 저장됨 — finish 시 drain.
      // "ignore"는 no-op.
    } catch (err) {
      console.error("[YUI] playMotion error:", err);
    }
  }

  function setMotionRegistry(registry: MotionRegistry): void {
    motionRegistry = registry;
    controller = createMotionController(registry);
    // VRM이 이미 떠 있으면 즉시 idle baseline 시작.
    if (currentVrm && mixer) playIdleBaseline();
  }

  /** setEmotion 구현 — resolve → 현재 blend에서 retarget → 크로스페이드 시작. */
  function setEmotion(emotion: EmotionSignal | null): void {
    // contract §1 "emotion 없으면 직전 표정 유지" — null은 NO-OP.
    // 오직 명시적 {id:"neutral"}만 neutral로 전이한다. (CRITICAL 비회귀)
    if (emotion === null) return;

    if (!emotionResolver || !emotionRegistry) {
      console.warn("[YUI] setEmotion called without an emotion registry — no-op");
      return;
    }
    if (!currentVrm) return;

    try {
      const resolved: ResolvedEmotion = emotionResolver.resolve(emotion);
      const now = elapsed * 1000;

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
      console.error("[YUI] setEmotion error:", err);
    }
  }

  function setEmotionRegistry(registry: EmotionRegistry): void {
    emotionRegistry = registry;
    // 현재 VRM 기준 존재 술어 재계산 + resolver 재생성.
    recomputeHasExpression();
  }

  return {
    loadVRM,
    onTick(fn) {
      tickHooks.add(fn);
      return () => {
        tickHooks.delete(fn);
      };
    },
    applyDirective(env) {
      // #16a render-wiring half: route emotion/motion into setEmotion(#6)/playMotion(#5)
      // per contract.md §3 render rules. TTS-prefix half (#16b / D-EMOTION-DUAL) deferred.
      routeDirective(env, { setEmotion, playMotion });
    },
    setEmotion,
    setMouthOpen(value) {
      mouth.setOpen(value);
    },
    stopMouth() {
      mouth.stop();
    },
    playMotion,
    setMotionRegistry,
    setEmotionRegistry,
    dispose() {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      disposeCurrent();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
