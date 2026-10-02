/** Voice operations per TTS provider — the speaker list, import, delete and re-upload dispatch here. */

import type { TtsProviderName } from "../../../contract";
import { deleteVoice, listVoices, upsertVoice } from "./tts-voices";

interface VoiceApi {
  list: typeof listVoices;
  /** Absent: the provider takes no uploaded voices, so import, delete and re-upload are off. */
  upsert?: typeof upsertVoice;
  remove?: typeof deleteVoice;
}

/** OpenAI's built-in voices; `tts-1` models speak only some of them. */
const OPENAI_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
];

/** A provider absent here has no voice list. */
export const VOICE_APIS: Partial<Record<TtsProviderName, VoiceApi>> = {
  irodori: { list: listVoices, upsert: upsertVoice, remove: deleteVoice },
  openai: { list: async () => [...OPENAI_VOICES] },
};
