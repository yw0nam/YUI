/**
 * apply-directive — pure routing for Renderer.applyDirective (#16a, render-wiring half).
 *
 * Routes a ControlEnvelope's emotion + motion channels into the already-working
 * setEmotion(#6) / playMotion(#5) sinks. NO three.js, NO VRM — pure dispatch so it is
 * unit-testable with spies (apply-directive.test.ts).
 *
 * Semantics are taken verbatim from docs/contract.md §3 "렌더 규약" (render rules) and §1:
 *  - §3 rule 1 (line 284): emotion present → expression transition; ABSENT → hold previous.
 *  - §3 rule 2 (line 285): motion present → registry lookup + play; ABSENT or null → idle.
 *  - §1 (line 84): `emotion === null` OR absent → NO-OP (hold previous); only an explicit
 *    `{id:"neutral"}` transitions to neutral. setEmotion(null) is itself a NO-OP hold (#6).
 *  - §3 rule 6 (line 289): `_reserved` ignored in v0.
 *
 * Note the deliberate asymmetry between the two channels (both contract-grounded):
 *  - emotion ABSENT → *passive* hold: do not touch the expression at all (no setEmotion call).
 *  - motion ABSENT/null → *active* return to idle: call playMotion(null).
 *
 * Out of scope for this layer (other tracks own them): should_speak (§3 rule 3),
 * speech_text, tool_status (§3 rule 4), rich_content (§3 rule 5).
 */

import type { ControlEnvelope, EmotionSignal, MotionSignal } from "../contract";

/** Render sinks the directive is routed into (Renderer.setEmotion / Renderer.playMotion). */
export interface DirectiveSinks {
  setEmotion(emotion: EmotionSignal | null): void;
  playMotion(motion: MotionSignal | null): void;
}

/**
 * Route the render channels of a ControlEnvelope into the given sinks (contract.md §3).
 *
 * - Emotion: forward only when the key is present (incl. explicit null). When the key is
 *   absent the expression is held — we make no setEmotion call (the cleanest "hold previous").
 *   A present `null` is forwarded as setEmotion(null), which #6 treats as a NO-OP hold. Any
 *   signal (including unregistered ids) is forwarded verbatim — the EmotionResolver owns
 *   fallback, not this routing layer.
 * - Motion: forward always — absent or null both become playMotion(null) → return to idle.
 */
export function routeDirective(env: ControlEnvelope, sinks: DirectiveSinks): void {
  // Emotion (§3 rule 1 / §1 line 84): present → transition, absent → hold (no call).
  if ("emotion" in env) {
    sinks.setEmotion(env.emotion ?? null);
  }

  // Motion (§3 rule 2): present → play, absent or null → idle.
  sinks.playMotion(env.motion ?? null);
}
