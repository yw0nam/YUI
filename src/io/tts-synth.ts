/** 한 문장 input → POST {tts_base_url}/v1/audio/speech → wav ArrayBuffer. */

import type { EndpointsConfig } from "../contract";

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

export function createTtsSynth(opts: TtsSynthOptions): TtsSynth {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const url = `${opts.config.tts_base_url}/v1/audio/speech`;

  return async (input, signal) => {
    const body: Record<string, unknown> = { input, response_format: "wav" };
    if (opts.model !== undefined) body.model = opts.model;
    if (opts.voice !== undefined) body.voice = opts.voice;
    if (opts.speed !== undefined) body.speed = opts.speed;

    const key = (await opts.getApiKey?.())?.trim() || undefined;
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
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

    return res.arrayBuffer();
  };
}
