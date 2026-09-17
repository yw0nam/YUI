/** Public types of the renderer: its options, the per-frame tick context, and the Renderer surface. */
import type { VRM } from "@pixiv/three-vrm";
import type { FramingConfig, GazeKnobs } from "../config/load";
import type { ControlEnvelope, EmotionRegistry, MotionRegistry } from "../contract";
import type { RenderEmotionSignal } from "./expression/emotion-resolver";
import type { OrbitAngles } from "./geometry/camera-fit";
import type { ScreenAnchor } from "./geometry/project-anchor";
import type { RenderMotionSignal } from "./motion/motion-controller";

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
  /** Fit-to-bounds framing; live path is setFraming. Absent until the config arrives. */
  framing?: FramingConfig;
  /** Cursor-gaze tracking thresholds; live path is setGaze. Absent until the config arrives. */
  gaze?: GazeKnobs;
  /** Alpha (0, 1] a rendered pixel must reach to count as the character; live path is setHitTestThreshold. */
  hitTestThreshold?: number;
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
  setEmotion(emotion: RenderEmotionSignal | null): void;
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
  playMotion(motion: RenderMotionSignal | null): void;
  /** Currently committed motion (variant-resolved) — null before any playback. */
  getCurrentMotion(): { id: string; vrma_path: string } | null;
  /**
   * Inject (or replace) motion registry. When injected, (re)generates MotionController; if
   * VRM is already loaded, plays the idle baseline.
   */
  setMotionRegistry(registry: MotionRegistry): void;
  /**
   * Restrict the ambient idle pool to these variant paths (the user's Character-tab selection).
   * Applies to the next rotation — a variant already playing finishes its cycle first.
   */
  setIdleVariants(paths: readonly string[]): void;
  /** Replace the fit-to-bounds framing; refits at once when a VRM is loaded. */
  setFraming(framing: FramingConfig): void;
  /**
   * Draw the reference-size framing — the window size at travel start — at canvas
   * offset `(x, y)`; null draws it to fill the whole canvas. A travel parks the OS
   * window over its whole path and uses this to keep the character's on-screen size
   * and every camera-projected consumer (feet anchor, width, hit test) unchanged while
   * she moves inside the parked canvas.
   */
  setViewWindow(view: { x: number; y: number; width: number; height: number } | null): void;
  /**
   * Set mouse-wheel zoom multiplier. Factor multiplied by fit distance (>1 ⇒ closer ⇒ larger).
   * Non-finite or identical values are no-ops. Clamping and persistence are caller's responsibility (src/io + main.ts).
   */
  setZoom(z: number): void;
  /**
   * Set orbit viewpoint (radians). azimuth is free (immediately applied); polar eases and narrows to [60°,120°]
   * while perched, then returns to saved free angle on perch release.
   * Clamping (free [2°,178°]) and persistence are caller's responsibility (src/io + main.ts).
   */
  setOrbit(angles: OrbitAngles): void;
  /**
   * Current screen pixel coordinates of character's feet (box center x/z, lowest y). null if VRM not loaded.
   * Changes whenever camera is refit via resize/zoom — used to pin UI input to feet.
   */
  getCharacterAnchor(): ScreenAnchor | null;
  /**
   * How wide the character stands on screen (px), measured across the model box at the
   * feet. The box is captured at load, so this is her rest-pose width rather than the
   * live silhouette. null if the VRM is not loaded — a jump sizes the gap it will clear
   * by it.
   */
  getCharacterWidthPx(): number | null;
  /**
   * Per-pixel alpha hit test: true when the rendered character pixel under the
   * window-local client CSS-px point (x, y) — e.g. MouseEvent.clientX/clientY — is
   * opaque (alpha ≥ threshold) — the true silhouette, including hair/transparent-
   * texture edges. Converted internally to stage-local via the renderer's own
   * cached mount rect. Samples a CPU-side low-res alpha grab refreshed inside the
   * render loop (with a 3×3 dilation so thin features stay hittable). False when
   * no VRM/grab is available yet. No GL readback happens here — the readback is
   * in the rAF loop.
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
   * Live hand positions in pet-window logical px, projected the same way the feet and
   * seat anchors are. null with no VRM or no hand bones. Diagnostic: it is how a mover
   * measures where the hands actually land against the thing they reach for.
   */
  getHandAnchors(): { left: { x: number; y: number }; right: { x: number; y: number } } | null;
  /** Live head/chest/hips projections in viewport CSS px plus the character's current screen height. */
  getTapPoints(): {
    head: { x: number; y: number } | null;
    chest: { x: number; y: number } | null;
    hips: { x: number; y: number } | null;
    charHpx: number;
  } | null;
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
  /** Set the side-peek edge pin, or clear it and restore the horizontal baseline. */
  setPeekTarget(target: { targetXpx: number } | null): void;
  /** Select mirrored clips for motions started after this call without restarting playback. */
  setMotionMirror(on: boolean): void;
  /**
   * Ease the character's root yaw (radians, 0 = camera-facing) to `rad` over `easeMs`.
   * The ambient stroll turns the body toward its travel direction through this.
   */
  setBodyYaw(rad: number, easeMs: number): void;
  /**
   * Screen pixels spanning one world metre at the current framing, measured at the
   * feet. null when no VRM is loaded — the stroll derives its ground speed from this
   * so the feet never slide at any window size or zoom.
   */
  getPxPerMetre(): number | null;
  /**
   * Cycle length (s) of a registered motion's loaded clip, null until it is cached.
   * A looping clip repeats on its own duration, which is what a ground speed must divide by.
   */
  getMotionDuration(id: string): number | null;
  /**
   * Vertical travel (signed metres) the loader levelled out of a `root_lock_y` clip —
   * what a mover has to supply by moving the window. null until the clip is cached,
   * 0 for a clip that keeps its own travel.
   */
  getMotionTravelY(id: string): number | null;
  /**
   * The same travel at one point in the clip, interpolated between its keyframes —
   * the curve the clip actually rises on, so a mover can follow it instead of a straight
   * line. Signed metres from the clip's first key. null until the clip is cached.
   */
  getMotionTravelAt(id: string, timeS: number): number | null;
  /** Clip-local playhead (s) of the committed motion. null when nothing is playing. */
  getCurrentMotionTime(): number | null;
  /**
   * Load a registered motion's clip into the cache without playing it, so its duration
   * and travel can be read before the motion starts. Resolves once loaded or given up on.
   */
  preloadMotion(id: string): Promise<void>;
  /**
   * Enable/disable the idle 30fps cap at runtime. Enabled (default) caps ambient-only
   * frames to IDLE_FPS; disabled renders idle frames at full refresh. Pause-on-hidden
   * is always on and unaffected by this toggle.
   */
  setIdleThrottleEnabled(enabled: boolean): void;
  /** Replace the cursor-gaze tracking thresholds; applies from the next frame. */
  setGaze(gaze: GazeKnobs): void;
  /**
   * Enable/disable cursor-gaze head+eye tracking at runtime. Disabled ⇒ the damped
   * gaze eases back to neutral (no snap) and the motion/eyes are left untouched once settled.
   */
  setGazeEnabled(enabled: boolean): void;
  /**
   * Latest window-local client CSS px OS-cursor position — e.g. MouseEvent.
   * clientX/clientY; null = unavailable. Converted internally to stage-local
   * before forwarding to cursor-gaze.
   */
  setGazeCursor(pos: { x: number; y: number } | null): void;
  /** Stop rAF loop + release GPU resources. */
  dispose(): void;
}
