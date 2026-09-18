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
import { VRMAnimationLoaderPlugin } from "@pixiv/three-vrm-animation";
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
import { createClipLibrary } from "./motion/clip-library";
import { createMotionPlayback } from "./motion/motion-playback";
import { createRootYaw } from "./motion/root-yaw";
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
  // Live motion registry — the clip library reads it through getRegistry.
  let motionRegistry: MotionRegistry | undefined = options.motionRegistry;
  const clips = createClipLibrary({ loader, getRegistry: () => motionRegistry, log });
  const motion = createMotionPlayback({
    clips,
    registry: motionRegistry,
    heldPosture: () => (pins.isPerched() ? "sitting" : pins.isPeeking() ? "peeking" : null),
    log,
  });

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
        motionActive: motion.isConverging(),
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
      motion.step(ctx);
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

  function disposeCurrent(): void {
    motion.onVrmDisposed();
    clips.onVrmDisposed();
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
    rootYaw.onVrmLoaded(vrm);
    currentVrm = vrm;
    scene.add(vrm.scene);

    // Adopt the VRM: cache bones, claim lookAt, recompute the per-model emotion
    // predicate/resolver — each participant's own onVrmLoaded, in fixed order.
    notifyVrmLoaded(participants, vrm);
    clips.onVrmLoaded(vrm);

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

    motion.onVrmLoaded(vrm); // New mixer for this VRM; if a registry exists, auto-play idle ambient.

    return { metaName: readVrmMetaName(vrm) };
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
      routeDirective(env, { setEmotion, playMotion: motion.playMotion });
    },
    setEmotion,
    easeEmotionToNeutral,
    setMouthOpen(value) {
      mouth.setOpen(value);
    },
    stopMouth() {
      mouth.stop();
    },
    playMotion: motion.playMotion,
    getCurrentMotion() {
      const cur = motion.current();
      return cur ? { id: cur.id, vrma_path: cur.vrma_path } : null;
    },
    setMotionRegistry(registry) {
      motionRegistry = registry;
      motion.setRegistry(registry);
    },
    setIdleVariants: motion.setIdleVariants,
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
        motion.playMotion(null); // perch cleared — explicit return to idle baseline.
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
      if (target === null) motion.playMotion(null);
    },
    setMotionMirror(on) {
      clips.setMirror(on);
    },
    setBodyYaw(rad, easeMs) {
      rootYaw.setTarget(rad, easeMs);
    },
    getPxPerMetre: probes.getPxPerMetre,
    getMotionDuration: clips.duration,
    getMotionTravelY: clips.travelY,
    getMotionTravelAt: clips.travelAt,
    getCurrentMotionTime: motion.currentTime,
    preloadMotion: clips.preload,
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
