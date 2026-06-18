/**
 * user_input_source — normalizes user input into bus envelopes.
 *
 * Produces:
 *  - user.text_submitted  — keyboard chat submit (tier2, dnd_override=true).
 *  - user.voice_segment_ready — STT transcript from VAD pipeline (tier2, dnd_override=true).
 */

import type { Transcript } from "../io/stt-vad";
import type { BusEnvelope, EventBus } from "./event-bus";

export interface UserInputSource {
  /** Chat submit → bus push. Pushes when text is non-empty OR ≥1 image is attached. */
  submit(text: string, images?: string[]): void;
  /** Voice transcript from STT → bus push. Empty transcript text is ignored. */
  submitVoice(transcript: Transcript): void;
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

    submitVoice(transcript) {
      if (transcript.text.trim().length === 0) return;
      const env: BusEnvelope = {
        source: "user_input_source",
        event_name: "user.voice_segment_ready",
        ts: Date.now(),
        payload: { transcript },
        hint_tier: 2,
        dnd_override: true,
      };
      bus.push(env);
    },
  };
}
