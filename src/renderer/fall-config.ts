/**
 * fall-config — tuning constants for the window-fall sequence.
 *
 * Pure values, no imports. Position units are logical px (== points, screen-Y
 * with down = +); time is in seconds; gravity is px/s², velocities px/s.
 *
 * The fall reads as a real drop (gravity ease-in / accelerating), distinct from
 * the ease-out used for UI surfaces. Defaults are tuned so a tiny fall isn't
 * instant and a full-screen fall isn't sluggish; see fall-integrator.ts.
 */

/** Downward acceleration in px/s². ~1200px full-screen fall lands in ~0.85s. */
export const FALL_GRAVITY = 3200;

/**
 * Velocity clamp in px/s. A typical fall stays just under this (true accel
 * feel); caps pathological tall-monitor falls from getting absurdly fast.
 */
export const FALL_TERMINAL_VELOCITY = 2800;

/** Hard cap in seconds: any fall snaps to target by here, however far. */
export const FALL_MAX_DURATION_S = 1.2;

/**
 * Playback rate for the falling.vrma loop while the integrator runs.
 * 1.0 plays the clip at authored speed.
 *
 * PHASE-0 AUDITION DEPENDENT — falling clip is a 2.5s loop; the right rate to
 * match the integrator's actual fall duration (and the 1.8s landing / 4.2s
 * suneru follow-ons) can only be set after auditioning the clips on the rig.
 */
export const FALLING_SPEED = 1.0;
