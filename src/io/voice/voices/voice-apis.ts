/** Voice operations per TTS provider — the speaker list, import, delete and re-upload dispatch here. */

import type { TtsProviderName } from "../../../contract";
import { deleteFishVoice, listFishVoices, upsertFishVoice } from "./fish-voices";
import {
  deleteVoice,
  listVoices,
  type UpsertVoiceOptions,
  upsertVoice,
  type VoiceEntry,
  type VoiceListFailure,
  type VoicesRequestOptions,
} from "./tts-voices";

/**
 * One list/import/delete bundle per provider. `upsert` resolves the server-assigned voice id when
 * the server names its own (Fish's trained models) and nothing otherwise.
 */
export interface VoiceApi {
  list: (
    opts: VoicesRequestOptions,
  ) => Promise<{ kind: "ok"; voices: VoiceEntry[] } | VoiceListFailure>;
  /** true: the list is built in; it says nothing about the server. */
  staticList?: true;
  /** Absent: the provider takes no uploaded voices, so import, delete and re-upload are off. */
  upsert?: (opts: UpsertVoiceOptions) => Promise<string | undefined>;
  remove?: typeof deleteVoice;
  /** true: an upload keeps the caller's voice id, so a lost clip can be uploaded again under it. */
  keepsId?: boolean;
  /** true: the provider speaks any voice id, not just listed ones — the panel offers a paste-id field. */
  manualId?: boolean;
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
  irodori: {
    list: async (opts) => {
      const result = await listVoices(opts);
      return result.kind === "ok"
        ? { kind: "ok", voices: result.ids.map((id) => ({ id })) }
        : result;
    },
    upsert: upsertVoice,
    remove: deleteVoice,
    keepsId: true,
  },
  openai: {
    list: async () => ({ kind: "ok", voices: OPENAI_VOICES.map((id) => ({ id })) }),
    staticList: true,
  },
  fish: { list: listFishVoices, upsert: upsertFishVoice, remove: deleteFishVoice, manualId: true },
};
