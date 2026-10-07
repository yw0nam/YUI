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
import type { EmotionRegistry, MotionRegistry } from "../contract";
import { createLogger } from "../logger";
import { routeDirective } from "./apply-directive";
import { clampPixelRatio } from "./camera/pixel-ratio";
import { createCameraRig } from "./camera/rig";
import type { ViewWindow } from "./camera/view-window";
import { createEmotionCrossfade, type EmotionCrossfade } from "./expression/emotion-crossfade";
import type { RenderEmotionSignal } from "./expression/emotion-resolver";
import { type CursorGaze, createCursorGaze } from "./expression/gaze/cursor-gaze";
import {
  createMouthLipsync,
  describeExpressions,
  MOUTH_EXPRESSION_KEY,
} from "./expression/mouth-lipsync";
import { createFrameLoop, type FrameLoop } from "./frame-loop";
import { type AlphaHitTest, createAlphaHitTest } from "./geometry/hit/alpha-hit-test";
import { clientToStage } from "./geometry/hit/stage-coords";
import { SEAT_DROP_DEFAULT } from "./geometry/probe/perch-geometry";
import { createScreenProbes } from "./geometry/probe/screen-probes";
import { createClipLibrary } from "./motion/clip/clip-library";
import { createMotionPlayback } from "./motion/playback/motion-playback";
import { createRootYaw } from "./motion/yaw/root-yaw";
import { createPinController, type PinController } from "./pin-controller";
import { createProps } from "./props/props";
import type { Renderer, RendererOptions, TickFn, VrmLoadResult } from "./types";
import { prepareVrm, readVrmMetaName } from "./vrm-loading";
import { buildVrmParticipants, notifyVrmDisposed, notifyVrmLoaded } from "./vrm-participant";

const log = createLogger("renderer");

/**
 * Seat drop below the hip bone (world units) for the window-sit perch.
 * Tunable: the seat-contact point sits this far below the hip joint.
 */
const SEAT_DROP = SEAT_DROP_DEFAULT;

export type { RenderEmotionSignal } from "./expression/emotion-resolver";
export { downPitchSign } from "./expression/gaze/bone-pitch";
export type { MouthLipsync } from "./expression/mouth-lipsync";
export type { RenderMotionSignal } from "./motion/playback/motion-controller";
export type {
  PropHandle,
  Renderer,
  RendererOptions,
  TickContext,
  TickFn,
  VrmLoadResult,
} from "./types";

export function createRenderer(options: RendererOptions): Renderer {
  const { mount } = options;

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(clampPixelRatio(window.devicePixelRatio));
  renderer.setClearColor(0x000000, 0); // transparent background — character only in pet window.
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();

  // Placeholder pose held until the configured framing arrives and a model box exists;
  // rig.fit then overrides position and fov from that box.
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  camera.position.set(0, 1.3, 1.6);
  camera.lookAt(new THREE.Vector3(0, 1.3, 0));

  // Fit-to-bounds state: full-body framing recomputed on load/swap/resize.
  let modelBox: THREE.Box3 | undefined;

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
  const rig = createCameraRig({
    camera,
    framing: options.framing ?? null,
    getModelBox: () => modelBox,
    isPerched: () => pins.isPerched(),
  });

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
    rig.resize(w, h);
    mountRect = mount.getBoundingClientRect();
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(mount);

  const tickHooks = new Set<TickFn>();

  // ── Root yaw (ambient stroll facing) ──────────────────────────────────
  const rootYaw = createRootYaw({ getElapsedMs: () => frameLoop.elapsedMs() });

  // ── Emotion crossfade ─────────────────────────────────────────────────
  // Owns the in-flight crossfade + resolver + per-model has-expression predicate.
  const emotion: EmotionCrossfade = createEmotionCrossfade({
    getVrm: () => currentVrm,
    getElapsedMs: () => frameLoop.elapsedMs(),
    registry: options.emotionRegistry,
    log,
  });

  // ── Furniture props ───────────────────────────────────────────────────
  // A plain loader: a prop carries no VRM extension for the plugins to read.
  const props = createProps({ scene, loader: new GLTFLoader(), log });

  // ── VrmParticipant unification ──────────────────────────────────────────
  // pins/gaze/emotion/mouth share the same per-frame lifecycle (adopt on load,
  // step before vrm.update, drop on dispose, report convergence) under mismatched
  // vocabularies (onVrmLoaded/onVrmDisposed/reset; step; isConverging/isFading/
  // openValue). buildVrmParticipants adapts each once here (not per frame, so the
  // per-frame step loop stays monomorphic) into the fixed order animate() already
  // ran them in: bones (pins/gaze) before expression weights (emotion/mouth), all
  // before vrm.update. Order + adapter wiring is unit-tested in vrm-participant.test.ts.
  const participants = buildVrmParticipants({ pins, gaze, emotion, mouth, props, camera });

  const frameLoop: FrameLoop = createFrameLoop({
    participants,
    motion,
    rig,
    rootYaw,
    tickHooks,
    getVrm: () => currentVrm,
    render: () => {
      renderer.render(scene, camera);
      // Refresh the low-res alpha grab (offscreen render-target readback) for the
      // hit-test. Frame-gated; runs in the rAF turn right after the main render.
      alphaHitTest.refresh();
    },
    log,
  });
  frameLoop.start();

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
    modelBox = undefined; // drop stale bounds so rig.fit no-ops until next load.
    alphaHitTest.clearGrab(); // stale silhouette can't outlive its VRM.
  }

  async function loadVRM(url: string): Promise<VrmLoadResult> {
    const gltf = await loader.loadAsync(url);
    const vrm = prepareVrm(gltf);

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
    rig.fit();

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

  function setViewWindow(next: ViewWindow | null): void {
    rig.setViewWindow(next);
    resize();
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
    setFraming: rig.setFraming,
    setFitBand: rig.setFitBand,
    setViewWindow,
    setZoom: rig.setZoom,
    setOrbit: rig.setOrbit,
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
        rig.startEase(); // ease the polar back to the stored free angle.
        motion.playMotion(null); // perch cleared — explicit return to idle baseline.
        return;
      }
      rig.startEase(); // ease the polar into the perched [60°,120°] band.
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
      frameLoop.setIdleThrottleEnabled(enabled);
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
    loadProp: props.load,
    getModelRestHipsHeight() {
      return currentVrm?.humanoid?.normalizedRestPose.hips?.position?.[1] ?? null;
    },
    dispose() {
      frameLoop.dispose();
      ro.disconnect();
      disposeCurrent();
      props.disposeAll();
      alphaHitTest.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
