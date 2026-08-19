/** Single-sentence input → POST {tts_base_url}/v1/audio/speech → wav ArrayBuffer. */

import type { EndpointsConfig } from "../contract";
import { createDeadlineSignal } from "./deadline";

/** Per-call synthesis direction that is not part of the spoken text. */
export interface TtsSynthCallOptions {
  /** Natural-language voice direction, sent as `irodori.caption`. */
  caption?: string;
}

export type TtsSynth = (
  input: string,
  signal?: AbortSignal,
  opts?: TtsSynthCallOptions,
) => Promise<ArrayBuffer>;

/** What the voice pipeline needs from the TTS path, so it never reads endpoints itself. */
export interface TtsProvider {
  synth: TtsSynth;
  /** Everything that changes the rendered audio, as one comparable string. */
  paramsKey(): string;
  /** Whether there is enough live config to synthesize right now. */
  isReady(): boolean;
}

// Deadline so a hung request settles instead of stalling the turn's ordered playback forever.
// One HTTP call per synth(), so this is the whole call's budget.
export const TTS_SYNTH_TIMEOUT_MS = 10_000;

export interface TtsSynthOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  model?: string;
  voice?: string;
  /** Resolves the TTS server key (Bearer) per request. Omitted/empty → no auth header. */
  getApiKey?: () => Promise<string | undefined>;
}

export function createTtsSynth(opts: TtsSynthOptions): TtsSynth {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const url = `${opts.baseUrl}/v1/audio/speech`;

  return async (input, signal, call) => {
    const body: Record<string, unknown> = { input, response_format: "wav" };
    if (opts.model !== undefined) body.model = opts.model;
    if (opts.voice !== undefined) body.voice = opts.voice;
    if (call?.caption) body.irodori = { caption: call.caption };

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

export interface TtsProviderDeps {
  getEndpoints: () => EndpointsConfig;
  /** The speaker picked in the panel — its id is the server-side voice id. */
  getActiveSpeaker: () => { id: string };
  /** Resolves the TTS server key (Bearer) per request. Omitted/empty → no auth header. */
  getApiKey?: () => Promise<string | undefined>;
  /** Environment fetch override (Tauri CORS-bypass) — resolved fresh per call. */
  selectFetch: () => Promise<typeof fetch | undefined>;
}

export function createTtsProvider(deps: TtsProviderDeps): TtsProvider {
  return {
    synth: async (input, signal, call) => {
      const eps = deps.getEndpoints();
      const fetchImpl = await deps.selectFetch();
      return createTtsSynth({
        baseUrl: eps.tts_base_url,
        fetch: fetchImpl,
        model: eps.tts_model,
        voice: deps.getActiveSpeaker().id,
        getApiKey: deps.getApiKey,
      })(input, signal, call);
    },
    paramsKey: () => {
      const eps = deps.getEndpoints();
      return [eps.tts_base_url, eps.tts_model, deps.getActiveSpeaker().id].join("::");
    },
    isReady: () => Boolean(deps.getEndpoints().tts_base_url && deps.getActiveSpeaker().id),
  };
}
