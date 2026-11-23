/**
 * The stored Gemini key's check: one model-list read whose refusal or acceptance is the verdict.
 * A verdict on the same key is reused for a minute, and an answer counts only while its key is
 * still the stored one.
 */

import type { ModelListResult } from "../../../../io/chat/models/reader";
import { GEMINI_PRESET } from "../../constants";
import { createModelRead } from "../chat/model-read";

// A stored-key check answer is reused on the same key for this long.
const CHECK_REUSE_MS = 60_000;

/** A refused key: a 401 or 403, or the HTTP 400 Gemini answers for a bad key. */
export function isRefused(result: ModelListResult): boolean {
  return result.kind === "refused" || (result.kind === "http" && result.status === 400);
}

export function createStoredKeyCheck(deps: {
  getStoredKey: () => string;
  getFetch: () => Promise<typeof globalThis.fetch | undefined>;
  /** The key passed (true) or was refused (false); a network failure reports nothing. */
  onVerdict: (ok: boolean) => void;
}): { run(): void; dispose(): void } {
  // The key the check sent.
  let checkedKey = "";
  // The last answer on a key: a burst of window focus events sends one request.
  let lastVerdict: { key: string; at: number; ok: boolean } | null = null;
  const read = createModelRead({
    getApiKey: async () => (checkedKey = deps.getStoredKey()),
    getFetch: deps.getFetch,
    onPhase: (phase) => {
      if (phase.phase !== "done" || checkedKey !== deps.getStoredKey()) return;
      const { result } = phase;
      if (result.kind !== "ok" && !isRefused(result)) return;
      lastVerdict = { key: checkedKey, at: Date.now(), ok: result.kind === "ok" };
      deps.onVerdict(lastVerdict.ok);
    },
  });
  return {
    run(): void {
      const key = deps.getStoredKey();
      if (lastVerdict?.key === key && Date.now() - lastVerdict.at < CHECK_REUSE_MS) {
        deps.onVerdict(lastVerdict.ok);
      } else read.start(GEMINI_PRESET.url);
    },
    dispose: read.dispose,
  };
}
