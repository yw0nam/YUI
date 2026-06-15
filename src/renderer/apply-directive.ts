/**
 * apply-directive — pure routing for Renderer.applyDirective.
 *
 * Routes a ControlEnvelope's emotion + motion channels into the
 * setEmotion / playMotion sinks. NO three.js, NO VRM — pure dispatch so it is
 * unit-testable with spies.
 *
 * Render rules:
 *  - emotion present → expression transition; ABSENT → hold previous.
 *  - motion present → registry lookup + play; ABSENT or null → idle.
 *  - `emotion === null` OR absent → NO-OP (hold previous); only an explicit
 *    `{id:"neutral"}` transitions to neutral. setEmotion(null) is itself a NO-OP hold.
 *  - `_reserved` ignored.
 *
 * Note the deliberate asymmetry between the two channels:
 *  - emotion ABSENT → *passive* hold: do not touch the expression at all (no setEmotion call).
 *  - motion ABSENT/null → *active* return to idle: call playMotion(null).
 *
 * Out of scope for this layer (other tracks own them):
 * speech_text, tool_status, rich_content.
 */

import type { ControlEnvelope, EmotionSignal, MotionSignal } from "../contract";

/** Render sinks the directive is routed into (Renderer.setEmotion / Renderer.playMotion). */
export interface DirectiveSinks {
  setEmotion(emotion: EmotionSignal | null): void;
  playMotion(motion: MotionSignal | null): void;
}

/**
 * Route the render channels of a ControlEnvelope into the given sinks.
 *
 * - Emotion: forward only when the key is present (incl. explicit null). When the key is
 *   absent the expression is held — we make no setEmotion call (the cleanest "hold previous").
 *   A present `null` is forwarded as setEmotion(null), which is treated as a NO-OP hold. Any
 *   signal (including unregistered ids) is forwarded verbatim — the EmotionResolver owns
 *   fallback, not this routing layer.
 * - Motion: forward always — absent or null both become playMotion(null) → return to idle.
 */
export function routeDirective(env: ControlEnvelope, sinks: DirectiveSinks): void {
  // Emotion: present → transition, absent → hold (no call).
  if ("emotion" in env) {
    sinks.setEmotion(env.emotion ?? null);
  }

  // Motion: present → play, absent or null → idle.
  sinks.playMotion(env.motion ?? null);
}
