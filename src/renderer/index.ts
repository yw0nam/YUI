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

import {
  type VRM,
  VRMHumanBoneList,
  type VRMHumanBoneName,
  VRMLoaderPlugin,
  VRMUtils,
} from "@pixiv/three-vrm";
import { createVRMAnimationClip, VRMAnimationLoaderPlugin } from "@pixiv/three-vrm-animation";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { FramingConfig } from "../config/load";
import type { EmotionRegistry, MotionRegistry } from "../contract";
import { createLogger } from "../logger";
import { routeDirective } from "./apply-directive";
import { type CursorGaze, createCursorGaze } from "./expression/cursor-gaze";
import { createEmotionCrossfade, type EmotionCrossfade } from "./expression/emotion-crossfade";
import type { RenderEmotionSignal } from "./expression/emotion-resolver";
import {
  createMouthLipsync,
  describeExpressions,
  MOUTH_EXPRESSION_KEY,
} from "./expression/mouth-lipsync";
import { type AlphaHitTest, createAlphaHitTest } from "./geometry/alpha-hit-test";
import {
  CAMERA_AZIMUTH_DEFAULT,
  CAMERA_POLAR_DEFAULT,
  clampPolar,
  computeCameraFit,
  type OrbitAngles,
  orbitPosition,
} from "./geometry/camera-fit";
import { isActive, shouldRenderFrame } from "./geometry/frame-gate";
import { SEAT_DROP_DEFAULT } from "./geometry/perch-geometry";
import { clampPixelRatio } from "./geometry/pixel-ratio";
import { createScreenProbes } from "./geometry/screen-probes";
import { clientToStage } from "./geometry/stage-coords";
import { applyViewWindow, type ViewWindow } from "./geometry/view-window";
import { createCycleDwell } from "./motion/cycle-dwell";
import { mirrorClipTracks } from "./motion/mirror-clip";
import {
  createMotionController,
  type MotionController,
  poolSelectionChanged,
  type RenderMotionSignal,
  type ResolvedMotion,
  shouldRestartIdle,
} from "./motion/motion-controller";
import { createDeadClipRegistry, resolveBaselineFallback } from "./motion/motion-fallback";
import { createMotionStartGeneration } from "./motion/motion-start-generation";
import { baselineWhileHeld, suppressWhileHeld } from "./motion/perch-hold";
import {
  detrendClipRootY,
  type RootYCurve,
  recenterClipRootMotion,
  sampleRootYCurve,
} from "./motion/recenter-root-motion";
import { createRootYaw } from "./motion/root-yaw";
import { clipCacheKey, playbackClip } from "./motion/self-crossfade";
import { createPinController, type PinController } from "./pin-controller";
import type { Renderer, RendererOptions, TickContext, TickFn, VrmLoadResult } from "./types";
import {
  anyConverging,
  buildVrmParticipants,
  notifyVrmDisposed,
  notifyVrmLoaded,
  stepParticipants,
} from "./vrm-participant";

const log = createLogger("renderer");

/**
 * Seat drop below the hip bone (world units) for the window-sit perch.
 * Tunable: the seat-contact point sits this far below the hip joint.
 */
const SEAT_DROP = SEAT_DROP_DEFAULT;
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

/** Ambient baseline pool id — the only pool whose variants the user selects. */
const IDLE_POOL_ID = "idle";

export type { RenderEmotionSignal } from "./expression/emotion-resolver";
export type { MouthLipsync, MouthLipsyncOptions } from "./expression/mouth-lipsync";
export {
  createMouthLipsync,
  describeExpressions,
  MOUTH_EXPRESSION_KEY,
} from "./expression/mouth-lipsync";
export type { RenderMotionSignal } from "./motion/motion-controller";
export type { Renderer, RendererOptions, TickContext, TickFn, VrmLoadResult } from "./types";

export function createRenderer(options: RendererOptions): Renderer {
  const { mount } = options;

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(clampPixelRatio(window.devicePixelRatio));
  renderer.setClearColor(0x000000, 0); // transparent background — character only in pet window.
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();

  // Placeholder pose held until the configured framing arrives and a model box exists;
  // fitCamera then overrides position and fov from that box.
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  camera.position.set(0, 1.3, 1.6);
  camera.lookAt(new THREE.Vector3(0, 1.3, 0));

  // Fit-to-bounds state: full-body framing recomputed on load/swap/resize.
  let modelBox: THREE.Box3 | undefined;
  // Set during a travel: draws the reference-size framing at an offset in the parked
  // canvas instead of filling it. null the rest of the time.
  let view: ViewWindow | null = null;
  // configs/avatar.json framing — null until setFraming delivers it (the renderer is
  // built before the config loads), and nothing is framed before then.
  let framing: FramingConfig | null = options.framing ?? null;
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

  // Owns both pin state machines + scene-position apply.
  const pins: PinController = createPinController({
    log,
    mountWidth: () => mount.clientWidth || 1,
    mountHeight: () => mount.clientHeight || 1,
  });
  const probes = createScreenProbes({
    camera,
    getVrm: () => currentVrm,
    getModelBox: () => modelBox,
    mountWidth: () => mount.clientWidth || 1,
    mountHeight: () => mount.clientHeight || 1,
    hipsBone: () => pins.hipsBone(),
    seatDrop: SEAT_DROP,
  });

  /** Reframe the camera to the current model box; no-op when no model is loaded. */
  function fitCamera(): void {
    if (!modelBox || !framing) return;
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
    return clampPolar(polar, pins.isPerched());
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
  /** User-selected ambient idle variants; null until the settings overlay is applied. */
  let idleVariants: readonly string[] | null = null;
  /** Every controller resolves the ambient pool through the live selection. */
  function newMotionController(registry: MotionRegistry): MotionController {
    return createMotionController(registry, {
      variantFilter: (id, variants) => {
        const enabled = idleVariants;
        if (id !== IDLE_POOL_ID || !enabled) return variants;
        return variants.filter((v) => enabled.includes(v));
      },
    });
  }
  let controller: MotionController | undefined = motionRegistry
    ? newMotionController(motionRegistry)
    : undefined;
  /** AnimationMixer for current VRM only (recreated on each hotswap). */
  let mixer: THREE.AnimationMixer | undefined;
  /** (vrma_path → AnimationClip) cache — clips are VRM-specific so cleared on hotswap. */
  const clipCache = new Map<string, THREE.AnimationClip>();
  /** Vertical travel (signed metres) levelled out of each cached clip; 0 when not locked. */
  const clipTravelY = new Map<string, number>();
  /** The rise each root-locked clip carries, as a curve a mover can follow. */
  const clipRootCurve = new Map<string, RootYCurve>();
  /** Hips world y in the loaded VRM's rest pose — where a root-locked clip is anchored. */
  let restHipsY: number | undefined;
  const deadClips = createDeadClipRegistry(log);
  /** Currently playing AnimationAction (prev in crossfade). */
  let currentAction: THREE.AnimationAction | undefined;
  let lastStateMotionId: string | null = null;
  /** mixer "finished" event → AnimationAction → motion id reverse lookup. */
  const actionToId = new Map<THREE.AnimationAction, string>();
  /** Hotswap race guard: if VRM changes during load async, discard. */
  let vrmEpoch = 0;
  const motionStartGeneration = createMotionStartGeneration();
  let motionMirror = false;
  const boneNameSwap = new Map<string, string>();
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
    threshold: options.hitTestThreshold ?? null,
    log,
  });

  // ── Cursor gaze (head/eye tracking) ───────────────────────────────────
  // Owns the damped gaze state + head/neck/lookAt apply; steps each frame in the rAF loop.
  const gaze: CursorGaze = createCursorGaze({
    camera,
    getVrm: () => currentVrm,
    gaze: options.gaze ?? null,
    log,
    mountWidth: () => mount.clientWidth || 1,
    mountHeight: () => mount.clientHeight || 1,
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

  // Cached mount rect (viewport-relative) for client→stage-local conversion
  // (hitTest/setGazeCursor). Refreshed alongside size in resize() — mount is
  // inset:0, so its rect only moves with the same layout changes that resize it.
  let mountRect = mount.getBoundingClientRect();

  function resize(): void {
    const w = mount.clientWidth || 1;
    const h = mount.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = view ? view.width / view.height : w / h;
    camera.updateProjectionMatrix();
    fitCamera(); // re-fit on resize so width-bound framing stays correct.
    applyViewWindow(camera, view, w, h);
    mountRect = mount.getBoundingClientRect();
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

  // ── Root yaw (ambient stroll facing) ──────────────────────────────────
  const rootYaw = createRootYaw({ getElapsedMs: () => elapsed * 1000 });

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

  // ── VrmParticipant unification ──────────────────────────────────────────
  // pins/gaze/emotion/mouth share the same per-frame lifecycle (adopt on load,
  // step before vrm.update, drop on dispose, report convergence) under mismatched
  // vocabularies (onVrmLoaded/onVrmDisposed/reset; step; isConverging/isFading/
  // openValue). buildVrmParticipants adapts each once here (not per frame, so the
  // per-frame step loop stays monomorphic) into the fixed order animate() already
  // ran them in: bones (pins/gaze) before expression weights (emotion/mouth), all
  // before vrm.update. Order + adapter wiring is unit-tested in vrm-participant.test.ts.
  const participants = buildVrmParticipants({ pins, gaze, emotion, mouth, camera });

  function animate(): void {
    rafId = requestAnimationFrame(animate);
    // Idle/active frame gate: while only ambient is running, cap to IDLE_FPS so the
    // frame budget is spared; full refresh is reserved for active animation. Skipped
    // frames do NOT consume the clock delta — it accumulates into the next rendered
    // frame so animation speed is unchanged.
    const active =
      isActive({
        participantsConverging: anyConverging(participants),
        motionActive: isMotionActive(),
      }) ||
      orbitConverging ||
      rootYaw.isConverging();
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
      const ctx: TickContext = { vrm: currentVrm, dt, elapsed };
      // Hooks first — bone/expression changes must be reflected in this frame's vrm.update(spring/expression apply).
      if (tickHooks.size > 0) {
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
      rootYaw.step(ctx);
      // pins/gaze (bones) then emotion/mouth (expression weights) — all before
      // vrm.update so expressionManager.update()/spring bones see this frame's writes.
      stepParticipants(participants, ctx);
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
    motionStartGeneration.invalidate();
    if (mixer) {
      mixer.removeEventListener("finished", onMixerFinished as never);
      mixer.stopAllAction();
      if (currentVrm) mixer.uncacheRoot(currentVrm.scene);
      mixer = undefined;
    }
    clipCache.clear();
    clipTravelY.clear();
    clipRootCurve.clear();
    restHipsY = undefined;
    motionMirror = false;
    boneNameSwap.clear();
    actionToId.clear();
    currentAction = undefined;
    // Controller has no simple no-op reset, so recreate to empty current/queue.
    // (Clips are VRM-specific so idle baseline must be replayed on next VRM anyway.)
    if (motionRegistry) controller = newMotionController(motionRegistry);
  }

  function disposeCurrent(): void {
    teardownMotion();
    // Drop each participant's VRM-bound state (reset in-flight fade/bone refs/damped
    // state) so nothing carries to the next VRM or writes to the disposed one.
    notifyVrmDisposed(participants);
    if (currentVrm) {
      scene.remove(currentVrm.scene);
      VRMUtils.deepDispose(currentVrm.scene);
      currentVrm = undefined;
    }
    modelBox = undefined; // drop stale bounds so fitCamera no-ops until next load.
    alphaHitTest.clearGrab(); // stale silhouette can't outlive its VRM.
  }

  /** Cache key of a registry id's representative clip, under the live mirror state. */
  function registryClipKey(id: string): string | null {
    const entry = motionRegistry?.[id];
    if (!entry) return null;
    return clipCacheKey(entry.vrma_path, motionMirror, !!entry.root_lock_y);
  }

  /**
   * vrma_path → AnimationClip (current VRM only). Returns immediately on cache hit.
   * Load .vrma via GLTFLoader + VRMAnimationLoaderPlugin → gltf.userData.vrmAnimations[0]
   * → createVRMAnimationClip(vrmAnimation, currentVrm) (three-vrm-animation official path).
   */
  async function loadClip(
    vrmaPath: string,
    mirrored: boolean,
    rootLockY = false,
  ): Promise<THREE.AnimationClip | null> {
    const cacheKey = clipCacheKey(vrmaPath, mirrored, rootLockY);
    const cached = clipCache.get(cacheKey);
    if (cached) return cached;
    if (!currentVrm) return null;

    if (mirrored) {
      const upright = await loadClip(vrmaPath, false, rootLockY);
      if (!upright) return null;
      const clip = mirrorClipTracks(upright, boneNameSwap);
      clipCache.set(cacheKey, clip);
      // Mirroring swaps left/right bones; the vertical travel and its curve are the upright clip's.
      const uprightKey = clipCacheKey(vrmaPath, false, rootLockY);
      clipTravelY.set(cacheKey, clipTravelY.get(uprightKey) ?? 0);
      const curve = clipRootCurve.get(uprightKey);
      if (curve) clipRootCurve.set(cacheKey, curve);
      return clip;
    }

    if (deadClips.isDead(vrmaPath)) return null;
    const epoch = vrmEpoch;
    let gltf: Awaited<ReturnType<typeof loader.loadAsync>>;
    try {
      gltf = await loader.loadAsync(vrmaPath);
    } catch (err) {
      // Fetch/parse failure is asset-permanent (above all an unshipped purchased motion,
      // where the app serves index.html instead) — warn once, never refetch.
      deadClips.markDead(vrmaPath, err);
      return null;
    }
    // If hotswap happened during load, discard.
    if (epoch !== vrmEpoch || !currentVrm) return null;

    const vrmAnimations = gltf.userData.vrmAnimations as unknown[] | undefined;
    const vrmAnimation = vrmAnimations?.[0];
    if (vrmAnimation == null) {
      deadClips.markDead(vrmaPath, "vrma_no_animations");
      return null;
    }
    const clip = createVRMAnimationClip(vrmAnimation as never, currentVrm);
    recenterClipRootMotion(clip); // strip baked horizontal root drift so the pet stays centered.
    // A clip whose rise IS the movement plays in place; the mover supplies the travel,
    // following the curve the clip had rather than a straight line through it.
    if (rootLockY) {
      const locked = detrendClipRootY(clip, restHipsY);
      clipTravelY.set(cacheKey, locked.travel);
      if (locked.curve) clipRootCurve.set(cacheKey, locked.curve);
      log.debug("clip.root_locked", {
        vrma_path: vrmaPath,
        travel: locked.travel,
        shift: locked.shift,
        keys: locked.curve?.times.length ?? 0,
      });
    } else {
      clipTravelY.set(cacheKey, 0);
    }
    clipCache.set(cacheKey, clip);
    return clip;
  }

  /**
   * Actually play resolved motion (load clip → compose action → crossfade).
   * controller.commit is performed by caller (playMotion/finish) with the decision.
   */
  async function startMotion(motion: ResolvedMotion): Promise<void> {
    const startToken = motionStartGeneration.begin();
    const mirrored = motionMirror;
    // Single play sink — cancel any pending dwell swap for new motion (prevents interrupt delay/stale swap).
    cycleDwell.cancel();
    if (!currentVrm || !mixer) return;
    const epoch = vrmEpoch;
    try {
      let clip = await loadClip(motion.vrma_path, mirrored, motion.root_lock_y);
      if (!motionStartGeneration.isCurrent(startToken)) return;
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
      clip = playbackClip(
        motion.vrma_path,
        mirrored,
        prev ? prev.getClip() : null,
        fadeMs,
        clipCache,
        motion.root_lock_y,
      );

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
      // The outgoing action keeps advancing during the fade and can still cross its own
      // clip end, dispatching a stale "finished" for it once a new motion has replaced it.
      if (prev && prev !== action) actionToId.delete(prev);

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
      if (motion.kind === "state") lastStateMotionId = motion.id;
    } catch (err) {
      log.error("start_motion", { error: String(err) });
      // Loader threw for the live VRM → recover to idle. Drops (hotswap/teardown) return silently.
      if (
        motionStartGeneration.isCurrent(startToken) &&
        epoch === vrmEpoch &&
        currentVrm &&
        mixer
      ) {
        fallbackToBaseline(motion.id);
      }
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
    if (!controller) return;
    const held = pins.isPerched() || pins.isPeeking();
    playMotion({ id: baselineWhileHeld(held, lastStateMotionId, controller.baseline()) });
  }

  // Read display name from VRM meta — VRM1.0 uses meta.name, VRM0.0 uses meta.title. null if neither.
  function readVrmMetaName(vrm: VRM): string | null {
    const meta = vrm.meta as { name?: unknown; title?: unknown } | undefined;
    const raw = typeof meta?.name === "string" ? meta.name : meta?.title;
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  function rebuildBoneNameSwap(vrm: VRM): void {
    boneNameSwap.clear();
    for (const leftName of VRMHumanBoneList) {
      if (!leftName.startsWith("left")) continue;
      const rightName = `right${leftName.slice(4)}` as VRMHumanBoneName;
      const leftNode = vrm.humanoid?.getNormalizedBoneNode(leftName);
      const rightNode = vrm.humanoid?.getNormalizedBoneNode(rightName);
      if (!leftNode || !rightNode) continue;
      boneNameSwap.set(leftNode.name, rightNode.name);
      boneNameSwap.set(rightNode.name, leftNode.name);
    }
    if (boneNameSwap.size === 0) log.warn("bone_name_swap_empty");
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
    rootYaw.onVrmLoaded(vrm);
    vrmEpoch += 1; // Invalidate async clip loads tied to prior model.
    currentVrm = vrm;
    scene.add(vrm.scene);

    // Adopt the VRM: cache bones, claim lookAt, recompute the per-model emotion
    // predicate/resolver — each participant's own onVrmLoaded, in fixed order.
    notifyVrmLoaded(participants, vrm);
    rebuildBoneNameSwap(vrm);

    // Full-body fit-to-bounds: measure in rest pose, before idle animates the arms.
    vrm.scene.updateWorldMatrix(true, true);
    modelBox = new THREE.Box3().setFromObject(vrm.scene);
    // Same moment, same reason: a root-locked clip rests its hips on this height.
    restHipsY = pins.hipsBone()?.getWorldPosition(new THREE.Vector3()).y;
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

    // New mixer for this VRM (clips are VRM-specific so start fresh).
    mixer = new THREE.AnimationMixer(vrm.scene);
    mixer.addEventListener("finished", onMixerFinished as never);

    playIdleBaseline(); // If registry exists, auto-play idle ambient.

    return { metaName: readVrmMetaName(vrm) };
  }

  /** playMotion implementation — request → (play/queue/ignore) → commit + actual playback. */
  function playMotion(motion: RenderMotionSignal | null): void {
    if (!controller) {
      log.warn("play_motion_no_registry");
      return;
    }
    if (!currentVrm || !mixer) return; // Playback not possible if VRM not loaded.
    const perched = pins.isPerched();
    const peeking = pins.isPeeking();
    if (suppressWhileHeld(motion, perched || peeking, (id) => motionRegistry?.[id]?.kind)) {
      if (motion) {
        log.info("motion_dropped_held_posture", {
          id: motion.id,
          posture: perched ? "sitting" : "peeking",
        });
      }
      return;
    }
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
    controller = newMotionController(registry);
    // If VRM is already loaded, immediately start idle baseline.
    if (currentVrm && mixer) playIdleBaseline();
  }

  function setIdleVariants(paths: readonly string[]): void {
    const previous = idleVariants;
    const next = [...paths];
    idleVariants = next;
    if (!poolSelectionChanged(previous, next)) return;
    // Nothing is playable before a VRM+mixer exist, so no motion can be stuck yet.
    const playing = currentVrm && mixer ? (controller?.current() ?? null) : null;
    if (shouldRestartIdle(previous, next, playing, IDLE_POOL_ID)) {
      // A pool of one loops without ever finishing — only a replay picks the change up.
      playIdleBaseline();
      return;
    }
    // Otherwise the change rides the next re-resolve. Drop the cached return target so a motion
    // playing over the pool cannot restore a resolution captured before the change.
    controller?.invalidatePool(IDLE_POOL_ID);
  }

  /** setEmotion — delegate to emotion crossfade (stable reference for routeDirective). */
  function setEmotion(signal: RenderEmotionSignal | null): void {
    emotion.setEmotion(signal);
  }

  /** Slowly ease prior emotion back to neutral via explicit transition (on TTS end). */
  function easeEmotionToNeutral(durationMs?: number): void {
    emotion.easeToNeutral(durationMs);
  }

  function setEmotionRegistry(registry: EmotionRegistry): void {
    emotion.setRegistry(registry);
  }

  function setFraming(next: FramingConfig): void {
    framing = next;
    fitCamera();
  }

  function setViewWindow(next: ViewWindow | null): void {
    view = next;
    resize();
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
    setIdleVariants,
    setEmotionRegistry,
    setFraming,
    setViewWindow,
    setZoom,
    setOrbit,
    getCharacterAnchor: probes.getCharacterAnchor,
    getCharacterWidthPx: probes.getCharacterWidthPx,
    hitTest(x, y) {
      const stage = clientToStage(x, y, mountRect);
      return alphaHitTest.hitTest(stage.x, stage.y);
    },
    setHitTestThreshold(threshold) {
      alphaHitTest.setThreshold(threshold);
    },
    getPerchProbe: probes.getPerchProbe,
    getTapPoints: probes.getTapPoints,
    getHandAnchors: probes.getHandAnchors,
    setPerchTarget(target) {
      const changed = pins.setPerchTarget(target);
      if (!changed) return;
      if (target === null) {
        orbitConverging = true; // ease the polar back to the stored free angle.
        playMotion(null); // perch cleared — explicit return to idle baseline.
        return;
      }
      orbitConverging = true; // ease the polar into the perched [60°,120°] band.
    },
    isPerched() {
      return pins.isPerched();
    },
    setPeekTarget(target) {
      const changed = pins.setPeekTarget(target);
      if (!changed) return;
      if (target === null) playMotion(null);
    },
    setMotionMirror(on) {
      motionMirror = on;
    },
    setBodyYaw(rad, easeMs) {
      rootYaw.setTarget(rad, easeMs);
    },
    getPxPerMetre: probes.getPxPerMetre,
    getMotionDuration(id) {
      const key = registryClipKey(id);
      const clip = key ? clipCache.get(key) : undefined;
      return clip ? clip.duration : null;
    },
    getMotionTravelY(id) {
      const key = registryClipKey(id);
      if (!key || !clipCache.has(key)) return null;
      return clipTravelY.get(key) ?? 0;
    },
    getMotionTravelAt(id, timeS) {
      const key = registryClipKey(id);
      if (!key || !clipCache.has(key)) return null;
      const curve = clipRootCurve.get(key);
      return curve ? sampleRootYCurve(curve, timeS) : 0;
    },
    getCurrentMotionTime() {
      const current = controller?.current();
      if (!current || !currentAction) return null;
      const key = registryClipKey(current.id);
      if (!key) return null;
      // A start is asynchronous, so the action can still be holding the previous clip —
      // its playhead would be a different clip's. The crossfade clone counts as ours.
      const playing = currentAction.getClip();
      if (playing !== clipCache.get(key) && playing !== clipCache.get(`${key}#xfade`)) return null;
      return currentAction.time;
    },
    async preloadMotion(id) {
      const entry = motionRegistry?.[id];
      if (!entry) return;
      await loadClip(entry.vrma_path, motionMirror, !!entry.root_lock_y);
    },
    setIdleThrottleEnabled(enabled) {
      idleThrottleEnabled = enabled;
    },
    setGaze(next) {
      gaze.setConfig(next);
    },
    setGazeEnabled(enabled) {
      gaze.setEnabled(enabled);
    },
    setGazeCursor(pos) {
      gaze.setCursorCss(pos && clientToStage(pos.x, pos.y, mountRect));
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
