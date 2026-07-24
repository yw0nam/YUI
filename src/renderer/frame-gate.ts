/**
 * frame-gate — pure idle/active frame-throttle decision (no DOM, no rAF, no GL).
 *
 * The rAF loop runs uncapped while the character is doing something the eye must
 * track at full refresh (lipsync, emotion crossfade, a non-idle motion clip, or a
 * perch pin still converging). When only ambient (blink/sway/breath) is running it
 * caps to a lower idle fps to spare the frame budget. Both pieces are pure so the
 * gating math and the active predicate are node-testable; the rAF wiring +
 * visibilitychange listener around them stays thin.
 */

/** Cheap per-frame signals — any one means the character is actively animating. */
interface ActiveState {
  /** Lipsync mouth-open amplitude (0..1); >~0 ⇒ TTS/lipsync is driving the mouth. */
  mouthOpen: number;
  /** An emotion crossfade is in progress (emotionXfade != null). */
  emotionFading: boolean;
  /** A non-idle motion clip is actively playing via the mixer. */
  motionActive: boolean;
  /** The perch seat-pin is set and not yet settled. */
  perchConverging: boolean;
}

/** Below this mouth amplitude the mouth reads as closed — treated as idle. */
const MOUTH_ACTIVE_EPSILON = 0.001;

/** True when any active signal is happening this frame — ⇒ run at full refresh. */
export function isActive(state: ActiveState): boolean {
  return (
    state.mouthOpen > MOUTH_ACTIVE_EPSILON ||
    state.emotionFading ||
    state.motionActive ||
    state.perchConverging
  );
}

/**
 * Decide whether to draw this frame. Active ⇒ always draw (uncapped). Idle ⇒ draw
 * only once the idle-fps interval has elapsed since the last render. A null
 * lastRenderMs (no prior render) always draws. When `throttleEnabled` is false the
 * idle cap is bypassed entirely — every frame draws (pause-on-hidden is separate).
 */
export function shouldRenderFrame(
  nowMs: number,
  lastRenderMs: number | null,
  active: boolean,
  targetIdleFps: number,
  throttleEnabled = true,
): boolean {
  if (active || !throttleEnabled) return true;
  if (lastRenderMs === null) return true;
  const idleIntervalMs = 1000 / targetIdleFps;
  // Tiny epsilon so a frame landing exactly one interval out renders despite
  // float rounding (e.g. (t + 1000/30) - t < 1000/30).
  return nowMs - lastRenderMs >= idleIntervalMs - 1e-6;
}
