/**
 * Renderer — three.js + @pixiv/three-vrm 출력 레이어.
 *
 * VRM 로드 + 핫스왑:
 *  - three.js scene/camera/light + rAF 루프 (vrm.update).
 *  - VRMLoaderPlugin으로 VRM 로드, VRMUtils 최적화, 투명 배경(펫 창).
 *  - loadVRM 재호출 = 핫스왑 (기존 모델 deepDispose 후 교체).
 *
 * applyDirective: ControlEnvelope의 emotion/motion 채널을 setEmotion/
 *   playMotion으로 라우팅. 순수 dispatch는 ./apply-directive.
 *
 * three-vrm 3.x 공식 경로(GLTFLoader.register(VRMLoaderPlugin) → gltf.userData.vrm,
 *   VRMUtils.removeUnnecessaryVertices/combineSkeletons/combineMorphs, deepDispose).
 */

import { type VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { createVRMAnimationClip, VRMAnimationLoaderPlugin } from "@pixiv/three-vrm-animation";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type {
  ControlEnvelope,
  EmotionRegistry,
  EmotionSignal,
  MotionRegistry,
  MotionSignal,
} from "../contract";
import { createLogger } from "../logger";
import { type AlphaHitTest, createAlphaHitTest } from "./alpha-hit-test";
import { routeDirective } from "./apply-directive";
import {
  CAMERA_AZIMUTH_DEFAULT,
  CAMERA_POLAR_DEFAULT,
  clampPolar,
  computeCameraFit,
  type OrbitAngles,
  orbitPosition,
} from "./camera-fit";
import { type CameraGaze, createCameraGaze } from "./camera-gaze";
import { createCycleDwell } from "./cycle-dwell";
import { createEmotionCrossfade, type EmotionCrossfade } from "./emotion-crossfade";
import { isActive, shouldRenderFrame } from "./frame-gate";
import type { GazeConfig } from "./gaze-tracker";
import {
  createMotionController,
  type MotionController,
  type ResolvedMotion,
} from "./motion-controller";
import { resolveBaselineFallback } from "./motion-fallback";
import { createMouthLipsync, describeExpressions, MOUTH_EXPRESSION_KEY } from "./mouth-lipsync";
import {
  characterScreenHeight,
  projectToScreen,
  SEAT_DROP_DEFAULT,
  seatAnchorWorld,
  seatAnchorWorldInto,
  seatOffsetWorldY,
  worldYPerPixel,
} from "./perch-geometry";
import { suppressIdleReturn } from "./perch-hold";
import { projectFeetAnchor, type ScreenAnchor } from "./project-anchor";
import { recenterClipRootMotion } from "./recenter-root-motion";

const log = createLogger("renderer");

/** Default fit-to-bounds framing — overridden by configs/avatar.json. */
const DEFAULT_FRAMING_MARGIN = 0.1;
const DEFAULT_FRAMING_FOV = 30;

/**
 * Seat drop below the hip bone (world units) for the window-sit perch.
 * Tunable: the seat-contact point sits this far below the hip joint.
 */
const SEAT_DROP = SEAT_DROP_DEFAULT;
/**
 * Fit-distance multiplier while perched. Offsetting the character up to pin its
 * seat can push head/feet out of frame; pulling the camera back keeps the pinned
 * pose framed. >1 ⇒ camera further ⇒ character smaller.
 */
const PERCH_ZOOM = 1.25;
/** Per-frame convergence rate for the seat-pin offset (proportional step). */
const PERCH_PIN_RATE = 0.6;
/**
 * Per-frame ease rate for the effective orbit polar (proportional step). Drag nudges
 * land in ~2 frames (feels direct); the larger jump when the perch clamp tightens the
 * polar into [60°,120°] eases over several frames instead of snapping.
 */
const ORBIT_EASE_RATE = 0.35;
/** Below this |Δpolar| (radians) the orbit ease is settled (≈0.06°). */
const ORBIT_SETTLE_EPS = 1e-3;

/** Idle (ambient-only) frame cap — full refresh is reserved for active animation. */
const IDLE_FPS = 30;

export interface RendererOptions {
  /** VRM을 렌더할 캔버스 마운트 대상. */
  mount: HTMLElement;
  /**
   * motion registry (configs/motions.json). 주입하면 playMotion이 동작한다.
   * 없으면 playMotion은 warn 후 no-op. setMotionRegistry로 나중에 주입 가능.
   */
  motionRegistry?: MotionRegistry;
  /**
   * emotion registry (configs/emotion_registry.json). 주입하면 setEmotion이 동작한다.
   * 없으면 setEmotion은 warn 후 no-op. setEmotionRegistry로 나중에 주입 가능.
   */
  emotionRegistry?: EmotionRegistry;
  /** Initial fit-to-bounds framing; live path is setFraming. Omitted keys keep defaults. */
  framing?: { margin?: number; fov?: number };
  /** Initial camera-gaze tracking thresholds; live path is setGaze. Omitted keys keep defaults. */
  gaze?: Partial<GazeConfig>;
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

/** loadVRM 결과 — VRMC_vrm/VRM0 메타에서 읽은 모델 이름(없으면 null). */
export interface VrmLoadResult {
  metaName: string | null;
}

export interface Renderer {
  /** VRM 로드 또는 핫스왑. 기존 모델이 있으면 새 모델 준비 후 dispose하고 교체. 메타 이름을 반환. */
  loadVRM(url: string): Promise<VrmLoadResult>;
  /**
   * 프레임 훅 등록. vrm.update(dt) **직전에** 호출되며,
   * currentVrm이 있을 때만 발화한다. 등록 해제 함수를 반환.
   */
  onTick(fn: TickFn): () => void;
  /**
   * 렌더 규약대로 render directive 적용.
   * emotion → setEmotion (present만, 없으면 hold/no-op), motion → playMotion
   * (없거나 null이면 idle 복귀). 순수 라우팅은 ./apply-directive routeDirective가 담당.
   */
  applyDirective(env: ControlEnvelope): void;
  /**
   * emotion → expression GPU 크로스페이드 전이.
   * registry가 주입돼 있고 VRM이 로드된 경우에만 동작.
   * emotion === null이면 NO-OP(직전 표정 유지). neutral 복귀는 명시적 {id:"neutral"}만.
   */
  setEmotion(emotion: EmotionSignal | null): void;
  /**
   * 직전 emotion을 neutral로 천천히 ease시킨다 (턴의 TTS 재생 종료 시). 명시적
   * {id:"neutral"} 전이를 긴 transition_ms로 흘려보내 setEmotion 크로스페이드를 그대로 재사용한다.
   * durationMs 미지정 시 느린 기본값. registry/VRM 미주입이면 setEmotion이 no-op.
   */
  easeEmotionToNeutral(durationMs?: number): void;
  /**
   * emotion registry 주입(또는 교체). 주입 시 현재 VRM 기준 hasExpression 술어를
   * 재계산하고 EmotionResolver를 (재)생성한다.
   */
  setEmotionRegistry(registry: EmotionRegistry): void;
  /**
   * 립싱크 입 벌림 목표 설정 (amplitude-only). value는 [0,1]로 clamp되며
   * 매 프레임 `aa` 프리셋으로 부드럽게(lerp) 반영된다. blink/lookAt/emotion 키는 건드리지 않는다.
   */
  setMouthOpen(value: number): void;
  /** 립싱크 정지 — 입을 0(닫힘)으로 ease한다. */
  stopMouth(): void;
  /** motion registry 조회 후 VRMA 재생. registry가 주입돼 있어야 동작. */
  playMotion(motion: MotionSignal | null): void;
  /**
   * motion registry 주입(또는 교체). 주입 시 MotionController를 (재)생성하고,
   * VRM이 이미 로드돼 있으면 idle baseline을 재생한다.
   */
  setMotionRegistry(registry: MotionRegistry): void;
  /**
   * Fit-to-bounds framing 갱신. 주어진 키만 현재 framing 위에 merge하고
   * (생략 키는 기본값 유지) VRM이 로드돼 있으면 즉시 재fit한다.
   */
  setFraming(framing: { margin?: number; fov?: number }): void;
  /**
   * Mouse-wheel zoom 배율 설정. fit 거리에 곱해지는 factor (>1 ⇒ 더 가까이 ⇒ 더 크게).
   * 비유한/동일 값은 no-op. 클램프·persist는 호출자(src/io + main.ts)가 담당한다.
   */
  setZoom(z: number): void;
  /** 현재 적용된 zoom 배율 반환. */
  getZoom(): number;
  /**
   * Orbit viewpoint 설정 (라디안). azimuth는 자유(즉시 적용), polar는 perch 중이면
   * [60°,120°]로 ease되어 좁혀지고 perch 해제 시 저장된 free 각도로 복귀한다.
   * 클램프(free [2°,178°])·persist는 호출자(src/io + main.ts)가 담당한다.
   */
  setOrbit(angles: OrbitAngles): void;
  /** 현재 적용 중인 orbit 각도 — azimuth + 저장된 free polar 반환. */
  getOrbit(): OrbitAngles;
  /**
   * 캐릭터 발밑(box 중앙 x/z, 최저 y)의 현재 화면 픽셀 좌표. VRM 미로드 시 null.
   * resize/zoom으로 카메라가 재fit될 때마다 변한다 — UI 입력을 발밑에 붙이는 데 쓴다.
   */
  getCharacterAnchor(): ScreenAnchor | null;
  /**
   * Per-pixel alpha hit test: true when the rendered character pixel under the
   * canvas CSS-px point (x, y), relative to the stage top-left, is opaque
   * (alpha ≥ threshold) — the true silhouette, including hair/transparent-texture
   * edges. Samples a CPU-side low-res alpha grab refreshed inside the render loop
   * (with a 3×3 dilation so thin features stay hittable). False when no VRM/grab
   * is available yet. No GL readback happens here — the readback is in the rAF loop.
   */
  hitTest(x: number, y: number): boolean;
  /**
   * Set the alpha threshold (0..1) the per-pixel hit test compares against.
   * Sourced from configs/avatar.json `hit_test.alpha_threshold` via main.ts.
   * Non-finite or out-of-(0,1] values are ignored.
   */
  setHitTestThreshold(threshold: number): void;
  /**
   * Live one-shot probe used at drop time to decide if the character is over a
   * window. Projects the live hips bone (+SEAT_DROP) to pet-window px (`seatPx`)
   * and measures the current on-screen pixel height (`charHpx`). null when no VRM
   * is loaded or bones/projection are unavailable.
   */
  getPerchProbe(): { seatPx: { x: number; y: number }; charHpx: number } | null;
  /**
   * Enter/exit perch-align mode. While a target is set, the seat (live hips
   * +SEAT_DROP) is pinned every frame to `edgeLocalYpx` (the target window's top
   * edge in pet-window-local px) via a dedicated additive vertical offset, and the
   * camera zooms out by PERCH_ZOOM to keep the lifted pose framed. null clears the
   * offset and restores normal framing — idle/cycle rendering is unaffected when unset.
   * The `window_sit` motion itself is driven separately via the normal directive path.
   */
  setPerchTarget(target: { edgeLocalYpx: number } | null): void;
  /** 현재 perch 활성 여부 — occlusion poll이 perch 종료를 감지하는 데 쓴다. */
  isPerched(): boolean;
  /**
   * Enable/disable the idle 30fps cap at runtime. Enabled (default) caps ambient-only
   * frames to IDLE_FPS; disabled renders idle frames at full refresh. Pause-on-hidden
   * is always on and unaffected by this toggle.
   */
  setIdleThrottleEnabled(enabled: boolean): void;
  /** Current idle-throttle toggle state (true = idle cap active). */
  getIdleThrottleEnabled(): boolean;
  /**
   * Camera-gaze tracking thresholds 갱신. 주어진(유한) 키만 현재 위에 merge하고
   * (생략 키 기본값 유지) 즉시 다음 프레임부터 적용된다.
   */
  setGaze(gaze: Partial<GazeConfig>): void;
  /**
   * Enable/disable camera-gaze head+eye tracking at runtime. Disabled ⇒ the damped
   * gaze eases back to neutral (no snap) and the motion/eyes are left untouched once settled.
   */
  setGazeEnabled(enabled: boolean): void;
  /** Current gaze toggle state (true = tracking the camera). */
  getGazeEnabled(): boolean;
  /** rAF 루프 정지 + GPU 리소스 해제. */
  dispose(): void;
}

export type { MouthLipsync, MouthLipsyncOptions } from "./mouth-lipsync";
export {
  createMouthLipsync,
  describeExpressions,
  MOUTH_EXPRESSION_KEY,
} from "./mouth-lipsync";

export function createRenderer(options: RendererOptions): Renderer {
  const { mount } = options;

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x000000, 0); // 투명 배경 — 펫 창에서 캐릭터만 보이게.
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();

  // Initial framing; fitCamera overrides position/fov from the model bounding box.
  const camera = new THREE.PerspectiveCamera(DEFAULT_FRAMING_FOV, 1, 0.1, 20);
  camera.position.set(0, 1.3, 1.6);
  camera.lookAt(new THREE.Vector3(0, 1.3, 0));

  // Fit-to-bounds state: full-body framing recomputed on load/swap/resize.
  let modelBox: THREE.Box3 | undefined;
  let framing = {
    margin: options.framing?.margin ?? DEFAULT_FRAMING_MARGIN,
    fov: options.framing?.fov ?? DEFAULT_FRAMING_FOV,
  };
  // Mouse-wheel zoom factor on top of the fit distance: >1 ⇒ closer ⇒ bigger.
  // Bounds/persistence live in src/io + main.ts (setZoom just applies). Default 1 = exact fit.
  let zoom = 1;
  // Orbit viewpoint on the fit sphere. azimuth/polar are the stored *free* angles
  // (clamp/persist in src/io + main.ts). effectivePolar is what the camera uses — it
  // eases toward the free polar, or toward the tightened perched clamp while perched.
  // azimuth applies directly (no clamp, no ease). Default (0, 90°) = head-on.
  let azimuth = CAMERA_AZIMUTH_DEFAULT;
  let polar = CAMERA_POLAR_DEFAULT;
  let effectivePolar = polar;
  // True while effectivePolar is still easing toward its target (keeps frames uncapped).
  let orbitConverging = false;

  // ── Window-sit perch state ──────────────────────────────────────────────────
  // Active target's top-edge in pet-window-local px (null = not perched).
  let perchTargetYpx: number | null = null;
  // Dedicated additive vertical offset we fully own — never clobbers root-motion
  // recentering. Applied onto vrm.scene.position.y after the mixer writes each frame.
  let perchOffsetY = 0;
  // Cached hips bone for the per-frame pin (refreshed on load; no per-frame lookup).
  let perchHipsBone: THREE.Object3D | null = null;
  // True while the seat-pin offset is still stepping toward the target (not settled).
  let perchConverging = false;
  // Scratch vectors reused every frame — no per-frame allocation in the pin path.
  const perchHipsWorld = new THREE.Vector3();
  const perchSeatWorld = new THREE.Vector3();
  const perchCamForward = new THREE.Vector3();
  const perchSeatRel = new THREE.Vector3();

  /** Reframe the camera to the current model box; no-op when no model is loaded. */
  function fitCamera(): void {
    if (!modelBox) return;
    const fit = computeCameraFit(modelBox, {
      fov: framing.fov,
      aspect: camera.aspect,
      margin: framing.margin,
    });
    if (!fit) return;
    // While perched, pull the camera back by PERCH_ZOOM so the lifted pose stays framed.
    const perchZoom = perchTargetYpx !== null ? PERCH_ZOOM : 1;
    const d = (fit.distance * perchZoom) / zoom; // zoom>1 ⇒ camera closer ⇒ character bigger.
    camera.fov = framing.fov;
    // Orbit composes with the radius pullback: orbit sets direction, zoom/PERCH_ZOOM
    // set the radius d. effectivePolar is the eased polar (free, or perched-clamped).
    const pos = orbitPosition(fit.target, d, { azimuth, polar: effectivePolar });
    camera.position.copy(pos);
    camera.lookAt(fit.target);
    camera.updateProjectionMatrix();
  }

  /** Target polar the camera should settle at: tightened to the perched band while perched. */
  function desiredPolar(): number {
    return clampPolar(polar, perchTargetYpx !== null);
  }

  /**
   * Ease effectivePolar one proportional step toward {@link desiredPolar} and re-fit.
   * No-op once settled (sub-epsilon) — keeps idle frames off the re-fit path. Runs each
   * frame from the rAF loop; orbitConverging gates the frame cap while still easing.
   */
  function stepOrbit(): void {
    const target = desiredPolar();
    const diff = target - effectivePolar;
    if (Math.abs(diff) <= ORBIT_SETTLE_EPS) {
      if (effectivePolar !== target) {
        effectivePolar = target;
        fitCamera();
      }
      orbitConverging = false;
      return;
    }
    effectivePolar += diff * ORBIT_EASE_RATE;
    orbitConverging = true;
    fitCamera();
  }

  const dir = new THREE.DirectionalLight(0xffffff, Math.PI);
  dir.position.set(1, 1, 1).normalize();
  scene.add(dir);
  scene.add(new THREE.AmbientLight(0xffffff, Math.PI * 0.3));

  // GLTFLoader는 VRM/VRMA 둘 다 로드 (three-vrm-animation 공식 예제).
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
  let currentVrm: VRM | undefined;

  // ── Motion playback 상태 ──────────────────────────────────────────────
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
  /** cycle 모션의 variant swap 전 dwell(정착 프레임 유지) 스케줄러 — startMotion이 취소 chokepoint. */
  const cycleDwell = createCycleDwell();

  // ── Lipsync 상태 ──────────────────────────────────────────────────────
  // 입(`aa`)은 lipsync 전용 — ambient/emotion와 분리. emotion crossfade와 같은
  // update 경로(vrm.update 직전)에서 매 프레임 lerp 반영한다.
  const mouth = createMouthLipsync();

  // ── Per-pixel alpha hit-test ──────────────────────────────────────────
  // Owns its own low-res silhouette grab + sampling; re-rendered in the rAF loop.
  const alphaHitTest: AlphaHitTest = createAlphaHitTest({
    renderer,
    scene,
    camera,
    isVrmLoaded: () => currentVrm != null,
    mountWidth: () => mount.clientWidth || 1,
    mountHeight: () => mount.clientHeight || 1,
    log,
  });

  // ── Camera gaze (head/eye tracking) ───────────────────────────────────
  // Owns the damped gaze state + head/neck/lookAt apply; steps each frame in the rAF loop.
  const gaze: CameraGaze = createCameraGaze({
    camera,
    getVrm: () => currentVrm,
    gaze: options.gaze,
    log,
  });

  /** mixer "finished" 핸들러 (oneshot 종료 → controller.finish → 복귀 재생). */
  const onMixerFinished = (e: { action: THREE.AnimationAction }): void => {
    try {
      const id = actionToId.get(e.action);
      actionToId.delete(e.action);
      if (!controller || !id) return;
      // cycle 모션이면 정착 마지막 프레임을 cycle_dwell_ms만큼 유지한 뒤 swap.
      const isCycle = controller.current()?.cycle ?? false;
      const dwell = motionRegistry?.[id]?.cycle_dwell_ms;
      const swap = (): void => {
        const decision = controller!.finish(id);
        controller!.commit(decision);
        if (decision.action === "play") {
          void startMotion(decision.motion);
        }
      };
      cycleDwell.onFinish(isCycle, dwell, swap);
    } catch (err) {
      log.error("motion_finish_handler_error", { error: String(err) });
    }
  };

  function resize(): void {
    const w = mount.clientWidth || 1;
    const h = mount.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    fitCamera(); // re-fit on resize so width-bound framing stays correct.
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(mount);

  const tickHooks = new Set<TickFn>();
  const clock = new THREE.Clock();
  let elapsed = 0;
  let rafId = 0;
  // Frame-throttle bookkeeping: last rendered timestamp (perf-clock ms) for the
  // idle fps cap; null = no frame drawn yet (or just resumed) ⇒ draw immediately.
  let lastRenderMs: number | null = null;
  // True while the rAF loop is paused because the document is hidden/minimized.
  let paused = false;
  // Idle 30fps cap toggle (runtime). Disabled ⇒ idle frames render at full refresh.
  let idleThrottleEnabled = true;

  // ── Emotion crossfade ─────────────────────────────────────────────────
  // Owns the in-flight crossfade + resolver + per-model has-expression predicate.
  const emotion: EmotionCrossfade = createEmotionCrossfade({
    getVrm: () => currentVrm,
    getElapsedMs: () => elapsed * 1000,
    registry: options.emotionRegistry,
    log,
  });

  /** True while a non-baseline motion clip is actively playing via the mixer. */
  function isMotionActive(): boolean {
    if (!currentAction?.isRunning()) return false;
    const id = controller?.current()?.id;
    return id != null && id !== controller?.baseline();
  }

  function animate(): void {
    rafId = requestAnimationFrame(animate);
    // Idle/active frame gate: while only ambient is running, cap to IDLE_FPS so the
    // frame budget is spared; full refresh is reserved for active animation. Skipped
    // frames do NOT consume the clock delta — it accumulates into the next rendered
    // frame so animation speed is unchanged.
    const active =
      isActive({
        mouthOpen: mouth.openValue(),
        emotionFading: emotion.isFading(),
        motionActive: isMotionActive(),
        perchConverging,
      }) ||
      orbitConverging ||
      gaze.isConverging();
    const now = performance.now();
    if (!shouldRenderFrame(now, lastRenderMs, active, IDLE_FPS, idleThrottleEnabled)) return;
    lastRenderMs = now;

    const dt = clock.getDelta();
    // Ease the orbit polar toward its target (free, or perched-clamped) and re-fit.
    // Independent of the VRM — fitCamera no-ops without a model — so the camera settles
    // even between loads. Cheap when already settled (no re-fit).
    stepOrbit();
    if (currentVrm) {
      elapsed += dt;
      // 훅을 먼저 — bone/expression 변경이 이번 프레임 vrm.update(spring/expression apply)에 반영되도록.
      if (tickHooks.size > 0) {
        const ctx: TickContext = { vrm: currentVrm, dt, elapsed };
        for (const fn of tickHooks) {
          try {
            fn(ctx);
          } catch (err) {
            log.error("tick_hook_error", { error: String(err) });
          }
        }
      }
      // mixer 먼저 — bone 갱신 후 vrm.update가 spring/expression을 apply.
      if (mixer) {
        try {
          mixer.update(dt);
        } catch (err) {
          log.error("mixer_update_error", { error: String(err) });
        }
      }
      // perch seat-pin — after the mixer poses the hips, before vrm.update applies
      // spring bones, so the offset rides into this frame's render.
      stepPerch();
      // camera gaze — same slot as perch: rides the posed head/neck into vrm.update.
      gaze.step(dt);
      // emotion 크로스페이드 — expressionManager.update()는 vrm.update(dt) 안에서
      // 돌므로 weight를 그 직전에 써야 이번 프레임에 반영된다.
      emotion.step(dt);
      // lipsync — emotion과 같은 이유로 vrm.update 직전에 `aa` weight를 쓴다.
      if (currentVrm.expressionManager) {
        mouth.step(dt, currentVrm.expressionManager);
      }
      currentVrm.update(dt);
    }
    renderer.render(scene, camera);
    // Refresh the low-res alpha grab (offscreen render-target readback) for the
    // hit-test. Frame-gated; runs in the rAF turn right after the main render.
    alphaHitTest.refresh();
  }
  animate();

  // Pause the rAF loop entirely while the document is hidden/minimized; resume the
  // moment it is visible again. On resume, discard the paused gap (getDelta returns
  // the whole hidden duration otherwise — that would teleport animations) and clear
  // lastRenderMs so the first frame draws immediately.
  function onVisibilityChange(): void {
    if (document.visibilityState === "hidden") {
      if (paused) return;
      paused = true;
      cancelAnimationFrame(rafId);
      rafId = 0;
    } else {
      if (!paused) return;
      paused = false;
      clock.getDelta(); // drop the accumulated hidden gap so dt doesn't jump.
      lastRenderMs = null;
      animate();
    }
  }
  document.addEventListener("visibilitychange", onVisibilityChange);

  /** mixer/clip/action 캐시 + controller 상태를 모두 폐기 (핫스왑/dispose 공용). */
  function teardownMotion(): void {
    cycleDwell.cancel(); // 폐기될 mixer에 stale swap이 발화하지 않도록.
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
    emotion.reset();
    // Drop the perch bone ref so a stale bone can't be pinned on the next VRM.
    perchHipsBone = null;
    perchOffsetY = 0;
    // Drop gaze bone refs + reset damped state so nothing carries to the next VRM.
    gaze.onVrmDisposed();
    scene.remove(currentVrm.scene);
    VRMUtils.deepDispose(currentVrm.scene);
    currentVrm = undefined;
    modelBox = undefined; // drop stale bounds so fitCamera no-ops until next load.
    alphaHitTest.clearGrab(); // stale silhouette can't outlive its VRM.
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
      log.error("vrma_no_animations", { vrma_path: vrmaPath });
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
    // 단일 play sink — 어떤 새 모션이든 대기 중 dwell swap을 취소(인터럽트 지연·stale swap 방지).
    cycleDwell.cancel();
    if (!currentVrm || !mixer) return;
    const epoch = vrmEpoch;
    try {
      let clip = await loadClip(motion.vrma_path);
      if (!clip) {
        // Real load failure (clip missing/invalid for the live VRM) → fall back to idle.
        // A hotswap/teardown drop (epoch changed / no vrm / no mixer) just returns silently.
        if (epoch === vrmEpoch && currentVrm && mixer) fallbackToBaseline(motion.id);
        return;
      }
      if (!mixer || epoch !== vrmEpoch) return;

      log.debug("start_motion", { id: motion.id, vrma_path: motion.vrma_path });

      const fadeMs = Math.max(0, motion.fade_ms);
      const prev = currentAction;
      // self-crossfade cycle re-trigger: clipAction caches one action per clip, so
      // re-playing the same clip returns prev === action and the crossfade is skipped.
      // Swap to a cloned clip so the new action differs and crossFadeFrom can blend.
      if (motion.cycle && fadeMs > 0 && prev && prev.getClip().uuid === clip.uuid) {
        const cloneKey = `${motion.vrma_path}#xfade`;
        let cloneClip = clipCache.get(cloneKey);
        if (!cloneClip) {
          cloneClip = clip.clone();
          clipCache.set(cloneKey, cloneClip);
        }
        clip = cloneClip;
      }

      const action = mixer.clipAction(clip);
      action.timeScale = motion.speed;
      if (motion.loop && !motion.cycle) {
        // plain loop 또는 단일 variant pingpong(continuous).
        action.setLoop(motion.pingpong ? THREE.LoopPingPong : THREE.LoopRepeat, Infinity);
        action.clampWhenFinished = false;
      } else {
        // oneshot 또는 cycle: pingpong이면 2N reps 후, 아니면 1회 재생 후 finished로 controller.finish 구동.
        action.setLoop(
          motion.pingpong ? THREE.LoopPingPong : THREE.LoopOnce,
          motion.pingpong ? motion.loop_reps : 1,
        );
        action.clampWhenFinished = true;
        actionToId.set(action, motion.id);
      }

      const fade = fadeMs / 1000;
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
      log.error("start_motion", { error: String(err) });
      // Loader threw for the live VRM → recover to idle. Drops (hotswap/teardown) return silently.
      if (epoch === vrmEpoch && currentVrm && mixer) fallbackToBaseline(motion.id);
    }
  }

  /**
   * A motion's clip failed to load → repair controller state to idle and (re)play it.
   * playMotion commits before the async load, so a failed clip leaves current +
   * previousStable pinned at the dead id and a later idle blocked by priority;
   * force-committing idle (motion-fallback) overwrites both. Recursion guard: idle's
   * own failure resolves to null and no-ops. Honors public/purchased_motions/AGENTS.md.
   */
  function fallbackToBaseline(failedId: string): void {
    if (!controller) return;
    log.warn("motion_fallback_to_idle", { failed_id: failedId });
    const idle = resolveBaselineFallback(controller, failedId);
    if (idle) void startMotion(idle);
  }

  /** registry가 있으면 baseline을 깔아 항상 ambient가 돌게 한다. */
  function playIdleBaseline(): void {
    if (controller) playMotion({ id: controller.baseline() });
  }

  // ── Window-sit perch pin ─────────────────────────────────────────────────────

  /**
   * One frame of seat-pin alignment — called after mixer.update, before vrm.update.
   * Projects the live hips (+SEAT_DROP) seat to px, measures how far it is from the
   * target edge in world-Y, and steps a dedicated additive vertical offset toward it.
   *
   * The VRMA clip animates the hips *bone*, never vrm.scene.position — so scene.position.y
   * is a channel we fully own (no clobbering root recentering). We set it absolutely from
   * the accumulated offset. Proportional step (PERCH_PIN_RATE) ⇒ converges in ~1-2 frames
   * and re-pins for free across window_sit variant swaps (each new pose's seat re-aligns).
   * No-op when unset.
   */
  function stepPerch(): void {
    if (perchTargetYpx === null || !currentVrm || !perchHipsBone) return;
    try {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      // Live posed hips → seat-contact world point (hips dropped by SEAT_DROP on Y).
      perchHipsBone.getWorldPosition(perchHipsWorld);
      seatAnchorWorldInto(perchSeatWorld, perchHipsWorld, SEAT_DROP);
      const seatPx = projectToScreen(perchSeatWorld, camera, w, h);
      if (!seatPx) return;
      // View-axis depth: project (seat − eye) onto camera forward. worldYPerPixel's
      // perspective formula expects on-axis depth, not Euclidean distance.
      camera.getWorldDirection(perchCamForward);
      const depth = perchSeatRel.copy(perchSeatWorld).sub(camera.position).dot(perchCamForward);
      const wpp = worldYPerPixel(camera, depth, h);
      const delta = seatOffsetWorldY(seatPx.y, perchTargetYpx, wpp);
      // Sub-pixel residual ⇒ settled; lets the frame gate drop to idle fps once pinned.
      perchConverging = Math.abs(delta) > wpp;
      // Proportional step toward the target offset (converges in a couple frames).
      perchOffsetY += delta * PERCH_PIN_RATE;
      currentVrm.scene.position.y = perchOffsetY;
    } catch (err) {
      log.error("step_perch", { error: String(err) });
    }
  }

  // VRM 메타에서 표시 이름을 읽는다 — VRM1.0은 meta.name, VRM0.0은 meta.title. 둘 다 없으면 null.
  function readVrmMetaName(vrm: VRM): string | null {
    const meta = vrm.meta as { name?: unknown; title?: unknown } | undefined;
    const raw = typeof meta?.name === "string" ? meta.name : meta?.title;
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  async function loadVRM(url: string): Promise<VrmLoadResult> {
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

    // Cache the hips bone for the per-frame perch pin (avoids per-frame lookups).
    perchHipsBone = vrm.humanoid?.getNormalizedBoneNode("hips") ?? null;

    // Cache head/neck for the per-frame gaze nudge; claim lookAt for eye control.
    gaze.onVrmLoaded(vrm);

    // Full-body fit-to-bounds: measure in rest pose, before idle animates the arms.
    vrm.scene.updateWorldMatrix(true, true);
    modelBox = new THREE.Box3().setFromObject(vrm.scene);
    fitCamera();

    // observability: surface available expressions + whether the lipsync mouth key exists.
    const exprInfo = describeExpressions(currentVrm.expressionManager);
    log.info("vrm_loaded", {
      expressions: exprInfo.expressions,
      has_mouth: exprInfo.hasMouth,
    });
    if (!exprInfo.hasMouth) {
      log.warn("mouth_expression_missing", {
        key: MOUTH_EXPRESSION_KEY,
        expressions: exprInfo.expressions,
      });
    }

    // emotion: 존재 집합은 모델별이라 핫스왑마다 술어/resolver 재생성.
    emotion.onVrmLoaded();

    // 새 VRM 전용 mixer (clip은 VRM-specific이므로 함께 새로 시작).
    mixer = new THREE.AnimationMixer(vrm.scene);
    mixer.addEventListener("finished", onMixerFinished as never);

    playIdleBaseline(); // registry가 있으면 idle ambient를 자동 재생.

    return { metaName: readVrmMetaName(vrm) };
  }

  /** playMotion 구현 — request → (play/queue/ignore) → commit + 실제 재생. */
  function playMotion(motion: MotionSignal | null): void {
    if (!controller) {
      log.warn("play_motion_no_registry");
      return;
    }
    if (!currentVrm || !mixer) return; // VRM 미로드 시 재생 불가.
    // While perched, an implicit idle return (null) is a no-op so the held window_sit
    // survives emotion-only cues. Only an explicit exit (setPerchTarget(null)) lands idle.
    if (suppressIdleReturn(motion, perchTargetYpx !== null)) return;
    try {
      const decision = controller.request(motion);
      controller.commit(decision);
      if (decision.action === "play") {
        void startMotion(decision.motion);
      }
      // "queue"는 commit으로 슬롯에 저장됨 — finish 시 drain.
      // "ignore"는 no-op.
    } catch (err) {
      log.error("play_motion", { error: String(err) });
    }
  }

  function setMotionRegistry(registry: MotionRegistry): void {
    motionRegistry = registry;
    controller = createMotionController(registry);
    // VRM이 이미 떠 있으면 즉시 idle baseline 시작.
    if (currentVrm && mixer) playIdleBaseline();
  }

  /** setEmotion — emotion crossfade로 위임 (routeDirective에 넘길 안정 참조). */
  function setEmotion(signal: EmotionSignal | null): void {
    emotion.setEmotion(signal);
  }

  /** 직전 emotion을 명시적 neutral 전이로 천천히 되돌린다 (TTS 재생 종료 시). */
  function easeEmotionToNeutral(durationMs?: number): void {
    emotion.easeToNeutral(durationMs);
  }

  function setEmotionRegistry(registry: EmotionRegistry): void {
    emotion.setRegistry(registry);
  }

  /** setFraming 구현 — 주어진 키만 merge(생략 키 기본값 유지) 후 재fit. */
  function setFraming(next: { margin?: number; fov?: number }): void {
    framing = {
      margin: next.margin ?? framing.margin,
      fov: next.fov ?? framing.fov,
    };
    fitCamera();
  }

  /** setZoom 구현 — 비유한/동일 값은 무시, 그 외엔 zoom 갱신 후 재fit. */
  function setZoom(z: number): void {
    if (!Number.isFinite(z)) return;
    if (z === zoom) return;
    zoom = z;
    fitCamera();
  }

  /**
   * setOrbit 구현 — azimuth는 즉시 적용(재fit), polar는 free 값으로 저장하고 effectivePolar를
   * desiredPolar로 ease시키도록 orbitConverging을 켠다(매 프레임 stepOrbit이 수렴). 비유한 값 무시.
   */
  function setOrbit(angles: OrbitAngles): void {
    const az = Number.isFinite(angles.azimuth) ? angles.azimuth : azimuth;
    const pol = Number.isFinite(angles.polar) ? angles.polar : polar;
    if (az === azimuth && pol === polar) return;
    azimuth = az;
    polar = pol;
    orbitConverging = true; // ease effectivePolar toward the (possibly perched-clamped) target.
    fitCamera(); // apply the azimuth change immediately.
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
      // route emotion/motion into setEmotion/playMotion per render rules.
      routeDirective(env, { setEmotion, playMotion });
    },
    setEmotion,
    easeEmotionToNeutral,
    setMouthOpen(value) {
      mouth.setOpen(value);
    },
    stopMouth() {
      mouth.stop();
    },
    playMotion,
    setMotionRegistry,
    setEmotionRegistry,
    setFraming,
    setZoom,
    getZoom() {
      return zoom;
    },
    setOrbit,
    getOrbit() {
      return { azimuth, polar };
    },
    getCharacterAnchor() {
      if (!modelBox) return null;
      camera.updateMatrixWorld();
      return projectFeetAnchor(modelBox, camera, mount.clientWidth || 1, mount.clientHeight || 1);
    },
    hitTest(x, y) {
      return alphaHitTest.hitTest(x, y);
    },
    setHitTestThreshold(threshold) {
      alphaHitTest.setThreshold(threshold);
    },
    getPerchProbe() {
      if (!currentVrm) return null;
      const head = currentVrm.humanoid?.getNormalizedBoneNode("head");
      const hips = perchHipsBone;
      if (!head || !hips) return null;
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      camera.updateMatrixWorld();

      // Seat: live hips (+SEAT_DROP) → pet-window px (mirrors getCharacterAnchor's project path).
      const hipsWorld = hips.getWorldPosition(new THREE.Vector3());
      const seat = seatAnchorWorld(hipsWorld, SEAT_DROP);
      const seatPx = projectToScreen(seat, camera, w, h);
      if (!seatPx) return null;

      // On-screen height: head top vs the live posed model's lowest point.
      // Recompute a live box so it tracks the current pose/scale (modelBox is the idle fallback).
      const headWorld = head.getWorldPosition(new THREE.Vector3());
      const liveBox = new THREE.Box3().setFromObject(currentVrm.scene);
      const feetWorld = liveBox.isEmpty()
        ? modelBox
          ? new THREE.Vector3(
              (modelBox.min.x + modelBox.max.x) / 2,
              modelBox.min.y,
              (modelBox.min.z + modelBox.max.z) / 2,
            )
          : null
        : new THREE.Vector3(
            (liveBox.min.x + liveBox.max.x) / 2,
            liveBox.min.y,
            (liveBox.min.z + liveBox.max.z) / 2,
          );
      if (!feetWorld) return null;
      const charHpx = characterScreenHeight(headWorld, feetWorld, camera, w, h);
      if (charHpx === null) return null;

      return { seatPx: { x: seatPx.x, y: seatPx.y }, charHpx };
    },
    setPerchTarget(target) {
      const wasPerched = perchTargetYpx !== null;
      if (target === null) {
        perchTargetYpx = null;
        perchOffsetY = 0;
        perchConverging = false;
        if (currentVrm) currentVrm.scene.position.y = 0; // restore baseline.
        if (wasPerched) {
          orbitConverging = true; // ease the polar back to the stored free angle.
          fitCamera(); // restore normal framing.
          playMotion(null); // perch cleared — explicit return to idle baseline.
        }
        return;
      }
      perchTargetYpx = target.edgeLocalYpx;
      if (!wasPerched) {
        orbitConverging = true; // ease the polar into the perched [60°,120°] band.
        fitCamera(); // apply PERCH_ZOOM on entry.
      }
    },
    isPerched() {
      return perchTargetYpx !== null;
    },
    setIdleThrottleEnabled(enabled) {
      idleThrottleEnabled = enabled;
    },
    getIdleThrottleEnabled() {
      return idleThrottleEnabled;
    },
    setGaze(next) {
      gaze.setConfig(next);
    },
    setGazeEnabled(enabled) {
      gaze.setEnabled(enabled);
    },
    getGazeEnabled() {
      return gaze.getEnabled();
    },
    dispose() {
      cancelAnimationFrame(rafId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      ro.disconnect();
      disposeCurrent();
      alphaHitTest.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
