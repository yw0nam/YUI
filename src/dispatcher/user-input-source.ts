/**
 * user_input_source — normalizes user input into bus envelopes.
 *
 * Produces:
 *  - user.text_submitted  — keyboard chat submit (tier2, dnd_override=true).
 *  - user.voice_segment_ready — STT text from VAD pipeline (tier2, dnd_override=true).
 * Both events carry the utterance in payload.text.
 */

import type { BusEnvelope, EventBus } from "./event-bus";

export interface UserInputSource {
  /** Chat submit → bus push. Pushes when text is non-empty OR ≥1 image is attached. */
  submit(text: string, images?: string[]): void;
  /** Voice text from STT → bus push with payload.text. Empty text is ignored. */
  submitVoice(text: string): void;
}

export function createUserInputSource(bus: EventBus): UserInputSource {
  return {
    submit(text, images) {
      const trimmed = text.trim();
      if (trimmed.length === 0 && (images?.length ?? 0) === 0) return;
      const env: BusEnvelope = {
        source: "user_input_source",
        event_name: "user.text_submitted",
        ts: Date.now(),
        payload: { text: trimmed, ...(images?.length ? { images } : {}) },
        hint_tier: 2,
        dnd_override: true,
      };
      bus.push(env);
    },

    submitVoice(text) {
      const trimmed = text.trim();
      if (trimmed.length === 0) return;
      const env: BusEnvelope = {
        source: "user_input_source",
        event_name: "user.voice_segment_ready",
        ts: Date.now(),
        payload: { text: trimmed },
        hint_tier: 2,
        dnd_override: true,
      };
      bus.push(env);
    },
  };
}
