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
import { routeDirective } from "./apply-directive";
import { computeCameraFit } from "./camera-fit";
import { createCycleDwell } from "./cycle-dwell";
import { revertEmotionToNeutral } from "./ease-emotion";
import {
  createEmotionResolver,
  type EmotionResolver,
  type ResolvedEmotion,
} from "./emotion-resolver";
import { isActive, shouldRenderFrame } from "./frame-gate";
import { cssToGrabCell, sampleAlphaHit } from "./hit-test";
import {
  createMotionController,
  type MotionController,
  type ResolvedMotion,
} from "./motion-controller";
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

// ── Per-pixel alpha hit-test (#8 PHASE-2) ────────────────────────────────────
/** Downscale factor (linear) of the drawing buffer for the CPU-side alpha grab. */
const ALPHA_GRAB_SCALE = 1 / 8;
/** Cap on the grab width (px) so large displays stay cheap. */
const ALPHA_GRAB_MAX_W = 128;
/** Refresh the grab every Nth frame (~20-30Hz) to spare the frame budget. */
const ALPHA_GRAB_FRAME_GATE = 3;
/** Fallback alpha threshold (0..1) until config injects one. */
const DEFAULT_ALPHA_THRESHOLD = 0.1;

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
  /** rAF 루프 정지 + GPU 리소스 해제. */
  dispose(): void;
}

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

  // ── Per-pixel alpha hit-test state ───────────────────────────────────────────
  // Low-res RGBA grab of the visible drawing buffer (reused; no per-frame alloc).
  let alphaGrab: Uint8Array | null = null;
  let alphaGrabW = 0;
  let alphaGrabH = 0;
  let alphaFrame = 0;
  // Threshold in 0..1 (config-injected); compared as 0..255 against the grab.
  let alphaThreshold = DEFAULT_ALPHA_THRESHOLD;

  /**
   * Refresh the CPU-side alpha grab from the default framebuffer. MUST run inside
   * the rAF loop right after renderer.render() — a same-turn gl.readPixels of the
   * default framebuffer is valid (the browser clears it only after JS yields), so
   * preserveDrawingBuffer is NOT needed. Reading from a poll/pointer callback
   * (outside the draw turn) would read zeros. Frame-gated + reused buffer to keep
   * the frame budget. No grab while no VRM is loaded.
   */
  function refreshAlphaGrab(): void {
    if (!currentVrm) {
      alphaGrab = null;
      return;
    }
    if (alphaFrame++ % ALPHA_GRAB_FRAME_GATE !== 0) return;
    try {
      const gl = renderer.getContext();
      // drawingBufferWidth/Height are device px (post devicePixelRatio).
      const bw = gl.drawingBufferWidth;
      const bh = gl.drawingBufferHeight;
      if (bw <= 0 || bh <= 0) return;
      const cap = Math.min(ALPHA_GRAB_MAX_W, Math.max(1, Math.round(bw * ALPHA_GRAB_SCALE)));
      const gw = cap;
      const gh = Math.max(1, Math.round((bh / bw) * gw));
      const need = gw * gh * 4;
      if (!alphaGrab || alphaGrab.length < need) alphaGrab = new Uint8Array(need);
      readDownscaled(gl, bw, bh, gw, gh, alphaGrab);
      alphaGrabW = gw;
      alphaGrabH = gh;
    } catch (err) {
      log.error("alpha_grab_error", { error: String(err) });
      alphaGrab = null;
    }
  }

  // Full-resolution scratch for a strided downscale read (reused across frames).
  let alphaFullBuf: Uint8Array | null = null;
  /**
   * Read the full device buffer and box-sample its alpha into the gw×gh grab
   * (nearest, stride-based). readPixels can only return 1:1 device px, so the
   * downscale happens on the CPU here. Grab rows stay bottom-up (readPixels origin).
   */
  function readDownscaled(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    bw: number,
    bh: number,
    gw: number,
    gh: number,
    out: Uint8Array,
  ): void {
    const full = bw * bh * 4;
    if (!alphaFullBuf || alphaFullBuf.length < full) alphaFullBuf = new Uint8Array(full);
    gl.readPixels(0, 0, bw, bh, gl.RGBA, gl.UNSIGNED_BYTE, alphaFullBuf);
    for (let r = 0; r < gh; r++) {
      const sy = Math.min(bh - 1, Math.floor((r / gh) * bh));
      for (let c = 0; c < gw; c++) {
        const sx = Math.min(bw - 1, Math.floor((c / gw) * bw));
        out[(r * gw + c) * 4 + 3] = alphaFullBuf[(sy * bw + sx) * 4 + 3];
      }
    }
  }

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
    camera.position.set(fit.target.x, fit.target.y, fit.target.z + d);
    camera.lookAt(fit.target);
    camera.updateProjectionMatrix();
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

  // ── Emotion 상태 ──────────────────────────────────────────────────────
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

  /** True while a non-idle motion clip is actively playing via the mixer. */
  function isMotionActive(): boolean {
    if (!currentAction?.isRunning()) return false;
    const id = controller?.current()?.id;
    return id != null && id !== "idle";
  }

  function animate(): void {
    rafId = requestAnimationFrame(animate);
    // Idle/active frame gate: while only ambient is running, cap to IDLE_FPS so the
    // frame budget is spared; full refresh is reserved for active animation. Skipped
    // frames do NOT consume the clock delta — it accumulates into the next rendered
    // frame so animation speed is unchanged.
    const active = isActive({
      mouthOpen: mouth.openValue(),
      emotionFading: emotionXfade !== null,
      motionActive: isMotionActive(),
      perchConverging,
    });
    const now = performance.now();
    if (!shouldRenderFrame(now, lastRenderMs, active, IDLE_FPS)) return;
    lastRenderMs = now;

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
    // Same-turn readback of the just-rendered default framebuffer for the alpha
    // hit-test. Must be here (after render, in the rAF turn) — reading later reads zeros.
    refreshAlphaGrab();
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
    emotionXfade = null;
    // Drop the perch bone ref so a stale bone can't be pinned on the next VRM.
    perchHipsBone = null;
    perchOffsetY = 0;
    scene.remove(currentVrm.scene);
    VRMUtils.deepDispose(currentVrm.scene);
    currentVrm = undefined;
    modelBox = undefined; // drop stale bounds so fitCamera no-ops until next load.
    alphaGrab = null; // stale silhouette can't outlive its VRM.
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
      const clip = await loadClip(motion.vrma_path);
      if (!clip || !mixer || epoch !== vrmEpoch) return;

      log.debug("start_motion", { id: motion.id, vrma_path: motion.vrma_path });

      const action = mixer.clipAction(clip);
      action.timeScale = motion.speed;
      if (motion.loop && !motion.cycle) {
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.clampWhenFinished = false;
      } else {
        // oneshot 또는 cycle: 한 번 재생 후 finished 이벤트로 controller.finish 구동.
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
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
      log.error("start_motion", { error: String(err) });
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
      log.error("step_emotion", { error: String(err) });
    }
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
    if (emotionRegistry) recomputeHasExpression();

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

  /** setEmotion 구현 — resolve → 현재 blend에서 retarget → 크로스페이드 시작. */
  function setEmotion(emotion: EmotionSignal | null): void {
    // "emotion 없으면 직전 표정 유지" — null은 NO-OP.
    // 오직 명시적 {id:"neutral"}만 neutral로 전이한다.
    if (emotion === null) return;

    if (!emotionResolver || !emotionRegistry) {
      log.warn("set_emotion_no_registry");
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
      log.error("set_emotion", { error: String(err) });
    }
  }

  /** 직전 emotion을 명시적 neutral 전이로 천천히 되돌린다 (TTS 재생 종료 시). */
  function easeEmotionToNeutral(durationMs?: number): void {
    revertEmotionToNeutral(durationMs, { setEmotion });
  }

  function setEmotionRegistry(registry: EmotionRegistry): void {
    emotionRegistry = registry;
    // 현재 VRM 기준 존재 술어 재계산 + resolver 재생성.
    recomputeHasExpression();
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
    getCharacterAnchor() {
      if (!modelBox) return null;
      camera.updateMatrixWorld();
      return projectFeetAnchor(modelBox, camera, mount.clientWidth || 1, mount.clientHeight || 1);
    },
    hitTest(x, y) {
      if (!alphaGrab || alphaGrabW === 0 || alphaGrabH === 0) return false;
      const cell = cssToGrabCell(
        x,
        y,
        mount.clientWidth || 1,
        mount.clientHeight || 1,
        alphaGrabW,
        alphaGrabH,
      );
      const threshold255 = Math.round(alphaThreshold * 255);
      return sampleAlphaHit(alphaGrab, alphaGrabW, alphaGrabH, cell.col, cell.row, threshold255);
    },
    setHitTestThreshold(threshold) {
      if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) return;
      alphaThreshold = threshold;
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
          fitCamera(); // restore normal framing.
          playMotion(null); // perch cleared — explicit return to idle baseline.
        }
        return;
      }
      perchTargetYpx = target.edgeLocalYpx;
      if (!wasPerched) fitCamera(); // apply PERCH_ZOOM on entry.
    },
    isPerched() {
      return perchTargetYpx !== null;
    },
    dispose() {
      cancelAnimationFrame(rafId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      ro.disconnect();
      disposeCurrent();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
