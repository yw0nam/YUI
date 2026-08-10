/** Single-sentence input → POST {tts_base_url}/v1/audio/speech → wav ArrayBuffer. */

import type { EndpointsConfig } from "../contract";
import { createDeadlineSignal } from "./deadline";
import { TTS_SYNTH_TIMEOUT_MS, type TtsProvider, type TtsSynth } from "./tts-provider";

export type { TtsSynth };
export { TTS_SYNTH_TIMEOUT_MS };

export interface TtsSynthOptions {
  config: EndpointsConfig;
  fetch?: typeof fetch;
  model?: string;
  voice?: string;
  speed?: number;
  /** Resolves the TTS server key (Bearer) per request. Omitted/empty → no auth header. */
  getApiKey?: () => Promise<string | undefined>;
}

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

export interface OpenAiTtsProviderDeps {
  getEndpoints: () => EndpointsConfig;
  /** Resolves the TTS server key (Bearer) per request. Omitted/empty → no auth header. */
  getApiKey?: () => Promise<string | undefined>;
  /** Environment fetch override (Tauri CORS-bypass) — resolved fresh per call. */
  selectFetch: () => Promise<typeof fetch | undefined>;
}

/** TtsProvider adapter over the OpenAI-compatible /v1/audio/speech path. */
export function createOpenAiTtsProvider(deps: OpenAiTtsProviderDeps): TtsProvider {
  return {
    synth: async (input, signal) => {
      const eps = deps.getEndpoints();
      const fetchImpl = await deps.selectFetch();
      return createTtsSynth({
        config: eps,
        fetch: fetchImpl,
        model: eps.tts_model,
        voice: eps.tts_voice,
        speed: eps.tts_speed,
        getApiKey: deps.getApiKey,
      })(input, signal);
    },
    paramsKey: () => {
      const eps = deps.getEndpoints();
      return ["openai", eps.tts_base_url, eps.tts_model, eps.tts_voice, eps.tts_speed].join("::");
    },
    isReady: () => Boolean(deps.getEndpoints().tts_base_url),
    emotionTextMode: () => "free",
  };
}
