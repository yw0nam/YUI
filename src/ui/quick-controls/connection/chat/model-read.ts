/**
 * The chat section's model-list read lifecycle — one read at a time: an identical in-flight read
 * (same URL and key) is reused, a newer start aborts and supersedes the older one, and only the
 * current read's completion is reported. Failures arrive as results; nothing throws.
 */

import type { ModelListResult } from "../../../../io/chat/models/reader";
import { readModels } from "../../../../io/chat/models/reader";
import { isValidEndpointUrl } from "../../../../settings/backend/endpoints-settings";

export type ModelReadPhase =
  | { phase: "reading" }
  | { phase: "done"; result: ModelListResult }
  | { phase: "cleared" };

export interface ModelRead {
  /** Starts (or joins) the read for this URL; phases report through onPhase. */
  start(url: string): void;
  /** Silently drops the in-flight read — nothing is reported. */
  abort(): void;
  /** Aborts and reports cleared — this URL cannot be read. */
  clear(): void;
  dispose(): void;
}

export function createModelRead(deps: {
  getApiKey: () => Promise<string | undefined>;
  getFetch: () => Promise<typeof globalThis.fetch | undefined>;
  onPhase: (phase: ModelReadPhase) => void;
}): ModelRead {
  const { getApiKey, getFetch, onPhase } = deps;

  let seq = 0;
  interface InFlight {
    url: string;
    key: string | undefined;
    controller: AbortController;
    alive: boolean;
  }
  let inFlight: InFlight | undefined;

  function drop(reported: boolean): void {
    if (inFlight) {
      inFlight.alive = false;
      inFlight.controller.abort();
      inFlight = undefined;
    }
    if (reported) onPhase({ phase: "cleared" });
  }

  async function start(url: string): Promise<void> {
    // No effective URL or an invalid one reads nothing — and clears what an older read showed.
    if (url.trim() === "" || !isValidEndpointUrl(url)) {
      drop(true);
      return;
    }
    // Allocated before any await, so a start that resumes late knows a newer one took over.
    const mySeq = ++seq;
    const key = await getApiKey();
    if (mySeq !== seq) return;
    if (inFlight && inFlight.url === url && inFlight.key === key) return;
    drop(false);
    const controller = new AbortController();
    const current: InFlight = { url, key, controller, alive: true };
    inFlight = current;
    onPhase({ phase: "reading" });
    try {
      const fetchImpl = (await getFetch()) ?? globalThis.fetch;
      if (!current.alive || mySeq !== seq) return;
      const result = await readModels({
        baseUrl: url,
        apiKey: key,
        signal: controller.signal,
        fetch: fetchImpl,
      });
      if (!current.alive || mySeq !== seq) return;
      inFlight = undefined;
      onPhase({ phase: "done", result });
    } catch {
      // readModels rejects only on abort — the read was replaced or cancelled; report nothing.
    }
  }

  return {
    start: (url) => void start(url),
    abort: () => drop(false),
    clear: () => drop(true),
    dispose: () => drop(false),
  };
}
