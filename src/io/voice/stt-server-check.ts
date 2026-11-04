/** Asks the STT server whether it answers: its model list, with any listing-less answer as ok. */

import { checkServer, type ServerCheck } from "../chat/models/server-check";
import { selectFetch } from "../chat/stream/chat-client";

/** Resolves null when there is no STT URL to check. */
export function createSttServerCheck(deps: {
  getEndpoints: () => { stt_base_url?: string } | null;
  getApiKey: () => Promise<string | undefined>;
}): () => Promise<ServerCheck | null> {
  return async () => {
    const eps = deps.getEndpoints();
    if (!eps?.stt_base_url) return null;
    const result = await checkServer({
      baseUrl: eps.stt_base_url,
      apiKey: await deps.getApiKey(),
      fetch: (await selectFetch()) ?? globalThis.fetch,
    });
    // A transcription-only server may answer /models with 405 or 501.
    return result.kind === "http" ? { kind: "ok" } : result;
  };
}
