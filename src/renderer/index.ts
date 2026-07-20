/**
 * Renderer — three.js + @pixiv/three-vrm output layer.
 *
 * VRM loading + hotswap:
 *  - three.js scene/camera/light + rAF loop (vrm.update).
 *  - Load VRM via VRMLoaderPlugin, optimize with VRMUtils, transparent background (pet window).
 *  - Re-call loadVRM = hotswap (deepDispose old model, then replace).
 *
 * applyDirective: routes ControlEnvelope emotion/motion channels to setEmotion/
 *   playMotion. Pure dispatch is ./apply-directive.
 *
 * three-vrm 3.x official path (GLTFLoader.register(VRMLoaderPlugin) → gltf.userData.vrm,
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
  /** Canvas element to mount the VRM render. */
  mount: HTMLElement;
  /**
   * motion registry (configs/motions.json). When injected, playMotion operates.
   * If absent, playMotion warns then no-ops. Can be injected later via setMotionRegistry.
   */
  motionRegistry?: MotionRegistry;
  /**
   * emotion registry (configs/emotion_registry.json). When injected, setEmotion operates.
   * If absent, setEmotion warns then no-ops. Can be injected later via setEmotionRegistry.
   */
  emotionRegistry?: EmotionRegistry;
  /** Initial fit-to-bounds framing; live path is setFraming. Omitted keys keep defaults. */
  framing?: { margin?: number; fov?: number };
  /** Initial camera-gaze tracking thresholds; live path is setGaze. Omitted keys keep defaults. */
  gaze?: Partial<GazeConfig>;
}

/** Context passed every rAF frame, **before vrm.update(dt)**. */
export interface TickContext {
  /** Currently loaded VRM (hook is invoked only when vrm exists). */
  readonly vrm: VRM;
  /** Time elapsed since the previous frame (seconds). */
  readonly dt: number;
  /** Total elapsed time since the first frame (seconds). */
  readonly elapsed: number;
}

/** Frame hook. Bone/expression changes must be made here (before vrm.update) to reflect in spring bone. */
export type TickFn = (ctx: TickContext) => void;

/** loadVRM result — model name read from VRMC_vrm/VRM0 meta (null if absent). */
export interface VrmLoadResult {
  metaName: string | null;
}

export interface Renderer {
  /** Load or hotswap VRM. If an existing model exists, prepare new model, dispose old, then replace. Returns meta name. */
  loadVRM(url: string): Promise<VrmLoadResult>;
  /**
   * Register frame hook. Called **before vrm.update(dt)**;
   * fires only when currentVrm exists. Returns unregister function.
   */
  onTick(fn: TickFn): () => void;
  /**
   * Apply render directive per render contract.
   * emotion → setEmotion (only if present, otherwise hold/no-op), motion → playMotion
   * (if absent or null, return to idle). Pure routing is handled by ./apply-directive routeDirective.
   */
  applyDirective(env: ControlEnvelope): void;
  /**
   * emotion → expression GPU crossfade transition.
   * Operates only when registry is injected and VRM is loaded.
   * emotion === null is a NO-OP (retains prior expression). Returns to neutral only via explicit {id:"neutral"}.
   */
  setEmotion(emotion: EmotionSignal | null): void;
  /**
   * Slowly ease the prior emotion to neutral (on turn's TTS playback end). Reuses setEmotion
   * crossfade by sending explicit {id:"neutral"} transition with long transition_ms.
   * If durationMs unspecified, uses slow default. If registry/VRM not injected, setEmotion no-ops.
   */
  easeEmotionToNeutral(durationMs?: number): void;
  /**
   * Inject (or replace) emotion registry. When injected, recomputes hasExpression predicate
   * relative to current VRM and (re)generates EmotionResolver.
   */
  setEmotionRegistry(registry: EmotionRegistry): void;
  /**
   * Set lipsync mouth-open target (amplitude-only). Value is clamped to [0,1] and
   * smoothly (lerp) applied each frame via `aa` preset. Does not touch blink/lookAt/emotion keys.
   */
  setMouthOpen(value: number): void;
  /** Stop lipsync — ease mouth to 0 (closed). */
  stopMouth(): void;
  /** Lookup motion registry and play VRMA. Registry must be injected to operate. */
  playMotion(motion: MotionSignal | null): void;
  /** Currently committed motion (variant-resolved) — null before any playback. */
  getCurrentMotion(): { id: string; vrma_path: string } | null;
  /**
   * Inject (or replace) motion registry. When injected, (re)generates MotionController; if
   * VRM is already loaded, plays the idle baseline.
   */
  setMotionRegistry(registry: MotionRegistry): void;
  /**
   * Update fit-to-bounds framing. Merge only given keys onto current framing
   * (omitted keys retain defaults); if VRM is loaded, immediately refit.
   */
  setFraming(framing: { margin?: number; fov?: number }): void;
  /**
   * Set mouse-wheel zoom multiplier. Factor multiplied by fit distance (>1 ⇒ closer ⇒ larger).
   * Non-finite or identical values are no-ops. Clamping and persistence are caller's responsibility (src/io + main.ts).
   */
  setZoom(z: number): void;
  /** Returns the currently applied zoom multiplier. */
  getZoom(): number;
  /**
   * Set orbit viewpoint (radians). azimuth is free (immediately applied); polar eases and narrows to [60°,120°]
   * while perched, then returns to saved free angle on perch release.
   * Clamping (free [2°,178°]) and persistence are caller's responsibility (src/io + main.ts).
   */
  setOrbit(angles: OrbitAngles): void;
  /** Returns currently applied orbit angles — azimuth + saved free polar. */
  getOrbit(): OrbitAngles;
  /**
   * Current screen pixel coordinates of character's feet (box center x/z, lowest y). null if VRM not loaded.
   * Changes whenever camera is refit via resize/zoom — used to pin UI input to feet.
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
   * edge in pet-window-local px) via a dedicated additive vertical offset. null
   * clears the offset — idle/cycle rendering is unaffected when unset.
   * The `window_sit` motion itself is driven separately via the normal directive path.
   */
  setPerchTarget(target: { edgeLocalYpx: number } | null): void;
  /** Current perch active state — used by occlusion poll to detect perch end. */
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
   * Update camera-gaze tracking thresholds. Merge only given (finite) keys onto current
   * (omitted keys retain defaults); applies immediately starting next frame.
   */
  setGaze(gaze: Partial<GazeConfig>): void;
  /**
   * Enable/disable camera-gaze head+eye tracking at runtime. Disabled ⇒ the damped
   * gaze eases back to neutral (no snap) and the motion/eyes are left untouched once settled.
   */
  setGazeEnabled(enabled: boolean): void;
  /** Current gaze toggle state (true = tracking the camera). */
  getGazeEnabled(): boolean;
  /** Stop rAF loop + release GPU resources. */
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
  renderer.setClearColor(0x000000, 0); // transparent background — character only in pet window.
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
    const d = fit.distance / zoom; // zoom>1 ⇒ camera closer ⇒ character bigger.
    camera.fov = framing.fov;
    // Orbit composes with the radius: orbit sets direction, zoom sets the radius d.
    // effectivePolar is the eased polar (free, or perched-clamped).
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

  // GLTFLoader loads both VRM/VRMA (three-vrm-animation official example).
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
  let currentVrm: VRM | undefined;

  // ── Motion playback state ──────────────────────────────────────────────
  let motionRegistry: MotionRegistry | undefined = options.motionRegistry;
  let controller: MotionController | undefined = motionRegistry
    ? createMotionController(motionRegistry)
    : undefined;
  /** AnimationMixer for current VRM only (recreated on each hotswap). */
  let mixer: THREE.AnimationMixer | undefined;
  /** (vrma_path → AnimationClip) cache — clips are VRM-specific so cleared on hotswap. */
  const clipCache = new Map<string, THREE.AnimationClip>();
  /** Currently playing AnimationAction (prev in crossfade). */
  let currentAction: THREE.AnimationAction | undefined;
  /** mixer "finished" event → AnimationAction → motion id reverse lookup. */
  const actionToId = new Map<THREE.AnimationAction, string>();
  /** Hotswap race guard: if VRM changes during load async, discard. */
  let vrmEpoch = 0;
  /** Scheduler for dwell (settling frame hold) before cycle motion variant swap — startMotion is cancel chokepoint. */
  const cycleDwell = createCycleDwell();

  // ── Lipsync state ──────────────────────────────────────────────────────
  // Mouth (`aa`) is lipsync-only — separate from ambient/emotion. Applied each frame via lerp in same
  // update path as emotion crossfade (before vrm.update).
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

  /** mixer "finished" handler (oneshot end → controller.finish → return playback). */
  const onMixerFinished = (e: { action: THREE.AnimationAction }): void => {
    try {
      const id = actionToId.get(e.action);
      actionToId.delete(e.action);
      if (!controller || !id) return;
      // if cycle motion, hold settling final frame for cycle_dwell_ms then swap.
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
      // Hooks first — bone/expression changes must be reflected in this frame's vrm.update(spring/expression apply).
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
      // Mixer first — after bone update, vrm.update applies spring/expression.
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
      // emotion crossfade — expressionManager.update() runs inside vrm.update(dt),
      // so weight must be written before to reflect in this frame.
      emotion.step(dt);
      // lipsync — same reason as emotion: write `aa` weight before vrm.update.
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

  /** Tear down mixer/clip/action cache + controller state (shared hotswap/dispose). */
  function teardownMotion(): void {
    cycleDwell.cancel(); // prevent stale swap on mixer being disposed.
    if (mixer) {
      mixer.removeEventListener("finished", onMixerFinished as never);
      mixer.stopAllAction();
      if (currentVrm) mixer.uncacheRoot(currentVrm.scene);
      mixer = undefined;
    }
    clipCache.clear();
    actionToId.clear();
    currentAction = undefined;
    // Controller has no simple no-op reset, so recreate to empty current/queue.
    // (Clips are VRM-specific so idle baseline must be replayed on next VRM anyway.)
    if (motionRegistry) controller = createMotionController(motionRegistry);
  }

  function disposeCurrent(): void {
    if (!currentVrm) return;
    teardownMotion();
    // Reset in-flight fade so it doesn't write to disposed VRM (shared hotswap/dispose).
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
   * vrma_path → AnimationClip (current VRM only). Returns immediately on cache hit.
   * Load .vrma via GLTFLoader + VRMAnimationLoaderPlugin → gltf.userData.vrmAnimations[0]
   * → createVRMAnimationClip(vrmAnimation, currentVrm) (three-vrm-animation official path).
   */
  async function loadClip(vrmaPath: string): Promise<THREE.AnimationClip | null> {
    const cached = clipCache.get(vrmaPath);
    if (cached) return cached;
    if (!currentVrm) return null;

    const epoch = vrmEpoch;
    const gltf = await loader.loadAsync(vrmaPath);
    // If hotswap happened during load, discard.
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
   * Actually play resolved motion (load clip → compose action → crossfade).
   * controller.commit is performed by caller (playMotion/finish) with the decision.
   */
  async function startMotion(motion: ResolvedMotion): Promise<void> {
    // Single play sink — cancel any pending dwell swap for new motion (prevents interrupt delay/stale swap).
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
        // plain loop or single-variant pingpong (continuous).
        action.setLoop(motion.pingpong ? THREE.LoopPingPong : THREE.LoopRepeat, Infinity);
        action.clampWhenFinished = false;
      } else {
        // oneshot or cycle: if pingpong then after 2N reps, otherwise once then controller.finish via finished.
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

  /** If registry exists, lay down baseline so ambient always plays. */
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

  // Read display name from VRM meta — VRM1.0 uses meta.name, VRM0.0 uses meta.title. null if neither.
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
    // Performance optimization (three-vrm official recommendation).
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
    VRMUtils.combineMorphs(vrm);
    vrm.scene.traverse((obj) => {
      obj.frustumCulled = false;
    });
    VRMUtils.rotateVRM0(vrm); // If VRM0.0, rotate to +Z front; VRM1.0 is no-op.

    disposeCurrent(); // Hotswap: prepare new model fully, then release prior.
    vrmEpoch += 1; // Invalidate async clip loads tied to prior model.
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

    // emotion: existence set is per-model so predicate/resolver recreated on each hotswap.
    emotion.onVrmLoaded();

    // New mixer for this VRM (clips are VRM-specific so start fresh).
    mixer = new THREE.AnimationMixer(vrm.scene);
    mixer.addEventListener("finished", onMixerFinished as never);

    playIdleBaseline(); // If registry exists, auto-play idle ambient.

    return { metaName: readVrmMetaName(vrm) };
  }

  /** playMotion implementation — request → (play/queue/ignore) → commit + actual playback. */
  function playMotion(motion: MotionSignal | null): void {
    if (!controller) {
      log.warn("play_motion_no_registry");
      return;
    }
    if (!currentVrm || !mixer) return; // Playback not possible if VRM not loaded.
    // While perched, an implicit idle return (null) is a no-op so the held window_sit
    // survives emotion-only cues. Only an explicit exit (setPerchTarget(null)) lands idle.
    if (suppressIdleReturn(motion, perchTargetYpx !== null)) return;
    try {
      const decision = controller.request(motion);
      controller.commit(decision);
      if (decision.action === "play") {
        void startMotion(decision.motion);
      }
      // "queue" is stored in slot via commit — drained on finish.
      // "ignore" is no-op.
    } catch (err) {
      log.error("play_motion", { error: String(err) });
    }
  }

  function setMotionRegistry(registry: MotionRegistry): void {
    motionRegistry = registry;
    controller = createMotionController(registry);
    // If VRM is already loaded, immediately start idle baseline.
    if (currentVrm && mixer) playIdleBaseline();
  }

  /** setEmotion — delegate to emotion crossfade (stable reference for routeDirective). */
  function setEmotion(signal: EmotionSignal | null): void {
    emotion.setEmotion(signal);
  }

  /** Slowly ease prior emotion back to neutral via explicit transition (on TTS end). */
  function easeEmotionToNeutral(durationMs?: number): void {
    emotion.easeToNeutral(durationMs);
  }

  function setEmotionRegistry(registry: EmotionRegistry): void {
    emotion.setRegistry(registry);
  }

  /** setFraming implementation — merge only given keys (omitted retain defaults), then refit. */
  function setFraming(next: { margin?: number; fov?: number }): void {
    framing = {
      margin: next.margin ?? framing.margin,
      fov: next.fov ?? framing.fov,
    };
    fitCamera();
  }

  /** setZoom implementation — ignore non-finite/identical, otherwise update zoom then refit. */
  function setZoom(z: number): void {
    if (!Number.isFinite(z)) return;
    if (z === zoom) return;
    zoom = z;
    fitCamera();
  }

  /**
   * setOrbit implementation — azimuth applies immediately (refit); polar is saved as free value and
   * orbitConverging is enabled to ease effectivePolar toward desiredPolar (stepOrbit converges each frame). Non-finite ignored.
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
    getCurrentMotion() {
      const cur = controller?.current();
      return cur ? { id: cur.id, vrma_path: cur.vrma_path } : null;
    },
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
          playMotion(null); // perch cleared — explicit return to idle baseline.
        }
        return;
      }
      perchTargetYpx = target.edgeLocalYpx;
      if (!wasPerched) {
        orbitConverging = true; // ease the polar into the perched [60°,120°] band.
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
