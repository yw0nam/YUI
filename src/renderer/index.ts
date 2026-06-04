/**
 * Renderer — three.js + @pixiv/three-vrm 출력 레이어. (PRD F1 / concept.md §2.A)
 *
 * 현재 구현 범위 = #4 VRM 로드 + 핫스왑:
 *  - three.js scene/camera/light + rAF 루프 (vrm.update).
 *  - VRMLoaderPlugin으로 VRM 로드, VRMUtils 최적화, 투명 배경(펫 창 #7).
 *  - loadVRM 재호출 = 핫스왑 (기존 모델 deepDispose 후 교체).
 *
 * 미구현(별 이슈):
 *  - setEmotion(#6 emotion→expression) / playMotion(#5 VRMA) / applyDirective(#16).
 *  - Tier1 ambient blend(#10), 립싱크(#15).
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
  MotionSignal,
  MotionRegistry,
} from "../contract";
import {
  createMotionController,
  type MotionController,
  type ResolvedMotion,
} from "./motion-controller";

export interface RendererOptions {
  /** VRM을 렌더할 캔버스 마운트 대상. */
  mount: HTMLElement;
  /**
   * motion registry (configs/motions.json). 주입하면 playMotion이 동작한다.
   * 없으면 playMotion은 warn 후 no-op (#4 단독 동작 유지). setMotionRegistry로 나중에 주입 가능.
   */
  motionRegistry?: MotionRegistry;
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
  /** contract.md §3 렌더 규약대로 render directive 적용. TODO(#16). */
  applyDirective(env: ControlEnvelope): void;
  /** emotion → expression 전이. TODO(#6). */
  setEmotion(emotion: EmotionSignal | null): void;
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

  return {
    loadVRM,
    onTick(fn) {
      tickHooks.add(fn);
      return () => {
        tickHooks.delete(fn);
      };
    },
    applyDirective(_env) {
      /* TODO(#16) */
    },
    setEmotion(_emotion) {
      /* TODO(#6) */
    },
    playMotion,
    setMotionRegistry,
    dispose() {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      disposeCurrent();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
