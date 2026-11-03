/** Whether Fish Audio accepts a TTS key — Quick start's voice step asks before it writes anything. */

import { createDeadlineSignal, untilAborted } from "../deadline";
import { VOICES_REQUEST_TIMEOUT_MS } from "./tts-voices";

export type FishKeyCheck = "ok" | "refused" | "failed";

export async function checkFishKey(opts: {
  baseUrl: string;
  key: string;
  fetch?: typeof fetch;
}): Promise<FishKeyCheck> {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const deadline = createDeadlineSignal(VOICES_REQUEST_TIMEOUT_MS, "Fish key check timed out");
  try {
    const res = await untilAborted(
      fetchImpl(`${opts.baseUrl}/model?self=true&page_size=1&page_number=1`, {
        headers: { Authorization: `Bearer ${opts.key}` },
        signal: deadline.signal,
      }),
      deadline.signal,
    );
    // Measured: a bad key answers 401, a good one 200.
    if (res.ok) return "ok";
    return res.status === 401 || res.status === 403 ? "refused" : "failed";
  } catch {
    return "failed";
  } finally {
    deadline.clear();
  }
}
