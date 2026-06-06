/**
 * ease-emotion — slow ease back to neutral when a turn's TTS playback ends.
 *
 * The renderer holds the last emotion (setEmotion(null) is a NO-OP hold, contract §1), so a
 * turn that set `happy` stays happy forever. After playback finishes we drift gently back to
 * neutral as an EXPLICIT `{id:"neutral"}` transition — the only signal that returns to neutral
 * per contract §1 — with a long transition_ms so it eases rather than snaps.
 *
 * Pure dispatch (mirrors apply-directive): NO three.js / VRM, so it is unit-testable with a
 * spy. The actual crossfade is reused unchanged by setEmotion(#6).
 */

import type { EmotionSignal } from "../contract";

/** Slow default revert duration (ms) — gentle drift, not the snappy 250ms default crossfade. */
export const DEFAULT_EMOTION_REVERT_MS = 1000;

/** Sink the revert is routed into (Renderer.setEmotion). */
export interface EmotionSink {
  setEmotion(emotion: EmotionSignal | null): void;
}

/**
 * Forward an explicit neutral transition with a slow duration. Never forwards null (that would
 * be a NO-OP hold). Negative durations are clamped to 0.
 */
export function revertEmotionToNeutral(durationMs: number | undefined, sink: EmotionSink): void {
  const transition_ms = Math.max(0, durationMs ?? DEFAULT_EMOTION_REVERT_MS);
  sink.setEmotion({ id: "neutral", transition_ms });
}
