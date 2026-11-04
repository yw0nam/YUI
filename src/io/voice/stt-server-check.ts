/** Asks the STT server whether it answers: any /models answer other than 401 or 403 counts as reachable. */

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
    // A 401/403 is a refused key; any other HTTP answer — a transcription-only server may have no /models — means the server answered.
    return result.kind === "http" ? { kind: "ok" } : result;
  };
}
