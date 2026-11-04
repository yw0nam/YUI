/** Asks the TTS server whether it answers: the voice list where it comes from the server, else the model list. */

import { ttsProviderOf } from "../../../config/tts-provider";
import type { TtsProviderName } from "../../../contract";
import { checkServer, type ServerCheck } from "../../chat/models/server-check";
import { selectFetch } from "../../chat/stream/chat-client";
import { VOICE_APIS } from "./voice-apis";
import type { VoiceListOutcome } from "./voice-list-refresh";

/** Resolves null when there is no TTS URL to check, or a newer refresh took the answer. */
export function createTtsServerCheck(deps: {
  getEndpoints: () => { tts_base_url?: string; tts_provider?: TtsProviderName } | null;
  getApiKey: () => Promise<string | undefined>;
  refreshVoiceList: () => Promise<VoiceListOutcome>;
}): () => Promise<ServerCheck | null> {
  return async () => {
    const eps = deps.getEndpoints();
    if (!eps?.tts_base_url) return null;
    if (VOICE_APIS[ttsProviderOf(eps)]?.staticList) {
      // The TTS URL carries no /v1; the speech path adds it.
      return checkServer({
        baseUrl: `${eps.tts_base_url.replace(/\/+$/, "")}/v1`,
        apiKey: await deps.getApiKey(),
        fetch: (await selectFetch()) ?? globalThis.fetch,
      });
    }
    const outcome = await deps.refreshVoiceList();
    return outcome.kind === "skipped" ? null : outcome;
  };
}
