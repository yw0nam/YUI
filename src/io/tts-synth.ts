/** Single-sentence input → POST {tts_base_url}/v1/audio/speech → wav ArrayBuffer. */

import type { EndpointsConfig } from "../contract";
import { createDeadlineSignal } from "./deadline";

export interface TtsSynthOptions {
  config: EndpointsConfig;
  fetch?: typeof fetch;
  model?: string;
  voice?: string;
  speed?: number;
  /** Resolves the TTS server key (Bearer) per request. Omitted/empty → no auth header. */
  getApiKey?: () => Promise<string | undefined>;
}

export type TtsSynth = (input: string, signal?: AbortSignal) => Promise<ArrayBuffer>;

// Deadline so a hung request settles instead of stalling the turn's ordered playback forever.
// Magnitude mirrors irodori-synth's RETRY_AFTER_CAP_MS (5s), with headroom for network + synth time.
export const TTS_SYNTH_TIMEOUT_MS = 10_000;

export function createTtsSynth(opts: TtsSynthOptions): TtsSynth {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const url = `${opts.config.tts_base_url}/v1/audio/speech`;

  return async (input, signal) => {
    const body: Record<string, unknown> = { input, response_format: "wav" };
    if (opts.model !== undefined) body.model = opts.model;
    if (opts.voice !== undefined) body.voice = opts.voice;
    if (opts.speed !== undefined) body.speed = opts.speed;

    const key = (await opts.getApiKey?.())?.trim() || undefined;
    const deadline = createDeadlineSignal(TTS_SYNTH_TIMEOUT_MS, "TTS request timed out");
    const requestSignal = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;

    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify(body),
        signal: requestSignal,
      });

      if (!res.ok) {
        let detail = "";
        try {
          const j = (await res.json()) as { error?: { message?: string } };
          if (j?.error?.message) detail = `: ${j.error.message}`;
        } catch {
          /* non-JSON body */
        }
        throw new Error(`TTS request failed (HTTP ${res.status})${detail}`);
      }

      return await res.arrayBuffer();
    } finally {
      deadline.clear();
    }
  };
}
