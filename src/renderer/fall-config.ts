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

/** Motion id played while the integrator runs. */
export const FALLING_MOTION_ID = "falling";

/** Oneshot landing motion, played to completion before the reaction. */
export const LANDING_MOTION_ID = "landing";

/**
 * Reaction motion after landing settles (the sulk). Swappable.
 *
 * PHASE-0 AUDITION DEPENDENT — reaction beat choice is tied to the landing
 * clip's settle frame; "suneru" is the current pick pending rig audition.
 */
export const LANDING_REACTION_ID = "suneru";

/**
 * Cadence throttle for the per-frame window Y-step (#143 U6). The integrator
 * computes Y every frame, but an IPC `setPosition` is issued only when the
 * accumulated delta crosses this many logical px AND the min interval elapsed,
 * capping IPC load without making the fall look stepped.
 */
export const SETPOS_MIN_DELTA_PX = 1;

/** Min seconds between issued setPosition calls (~30 Hz cap). */
export const SETPOS_MIN_INTERVAL_S = 1 / 30;

/**
 * Per-await deadline (ms) for the start() geometry probes. A hung
 * getWorkArea/getWindowGeom must fall back to Phase-1 idle, never freeze
 * mid-detach (must-fix #5).
 */
export const FALL_GEOMETRY_TIMEOUT_MS = 1000;
