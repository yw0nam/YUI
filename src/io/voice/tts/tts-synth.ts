/** Single-sentence input → POST {tts_base_url}/v1/audio/speech → wav ArrayBuffer. */

import { ttsProviderOf } from "../../../config/tts-provider";
import type { EndpointsConfig } from "../../../contract";
import { createDeadlineSignal, untilAborted } from "../deadline";

/** Per-call synthesis direction that is not part of the spoken text. */
export interface TtsSynthCallOptions {
  /** Voice tag from the cue (emoji for Irodori). */
  emotion_text?: string;
  /** Natural-language voice direction. */
  caption?: string;
}

/** The spoken input and the provider's own direction keys for one request. */
interface SpeechRequest {
  input: string;
  direction?: Record<string, unknown>;
}

/** How each provider carries the cue's direction; a provider absent here has no synth. */
const SPEECH_REQUEST = {
  irodori: (input: string, call?: TtsSynthCallOptions): SpeechRequest => ({
    input: call?.emotion_text ? `${call.emotion_text} ${input}` : input,
    ...(call?.caption ? { direction: { irodori: { caption: call.caption } } } : {}),
  }),
  openai: (input: string, call?: TtsSynthCallOptions): SpeechRequest => {
    const instructions = [call?.emotion_text, call?.caption].filter(Boolean).join(" ");
    return { input, ...(instructions ? { direction: { instructions } } : {}) };
  },
};

type SynthProvider = keyof typeof SPEECH_REQUEST;

function isSynthProvider(p: string): p is SynthProvider {
  return Object.hasOwn(SPEECH_REQUEST, p);
}

export type TtsSynth = (
  input: string,
  signal?: AbortSignal,
  opts?: TtsSynthCallOptions,
) => Promise<ArrayBuffer>;

/** What the voice pipeline needs from the TTS path, so it never reads endpoints itself. */
interface TtsProvider {
  synth: TtsSynth;
  /** Everything that changes the rendered audio, as one comparable string. */
  paramsKey(): string;
  /** Whether there is enough live config to synthesize right now. */
  isReady(): boolean;
}

// Deadline so a hung request settles instead of stalling the turn's ordered playback forever.
// One HTTP call per synth(), so this is the whole call's budget.
export const TTS_SYNTH_TIMEOUT_MS = 10_000;

interface TtsSynthOptions {
  provider: SynthProvider;
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
    const request = SPEECH_REQUEST[opts.provider](input, call);
    const body: Record<string, unknown> = { input: request.input, response_format: "wav" };
    if (opts.model !== undefined) body.model = opts.model;
    if (opts.voice !== undefined) body.voice = opts.voice;
    Object.assign(body, request.direction);

    const key = (await opts.getApiKey?.())?.trim() || undefined;
    const deadline = createDeadlineSignal(TTS_SYNTH_TIMEOUT_MS, "TTS request timed out");
    const requestSignal = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;

    try {
      const res = await untilAborted(
        fetchImpl(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(key ? { Authorization: `Bearer ${key}` } : {}),
          },
          body: JSON.stringify(body),
          signal: requestSignal,
        }),
        requestSignal,
      );

      if (!res.ok) {
        let detail = "";
        try {
          const j = (await untilAborted(res.json(), requestSignal)) as {
            error?: { message?: string };
          };
          if (j?.error?.message) detail = `: ${j.error.message}`;
        } catch {
          /* non-JSON body */
        }
        throw new Error(`TTS request failed (HTTP ${res.status})${detail}`);
      }

      return await untilAborted(res.arrayBuffer(), requestSignal);
    } finally {
      deadline.clear();
    }
  };
}

interface TtsProviderDeps {
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
      const provider = ttsProviderOf(eps);
      if (!isSynthProvider(provider)) throw new Error(`no TTS synth for provider "${provider}"`);
      const fetchImpl = await deps.selectFetch();
      return createTtsSynth({
        provider,
        baseUrl: eps.tts_base_url,
        fetch: fetchImpl,
        model: eps.tts_model,
        voice: deps.getActiveSpeaker().id,
        getApiKey: deps.getApiKey,
      })(input, signal, call);
    },
    paramsKey: () => {
      const eps = deps.getEndpoints();
      return [ttsProviderOf(eps), eps.tts_base_url, eps.tts_model, deps.getActiveSpeaker().id].join(
        "::",
      );
    },
    isReady: () => {
      const eps = deps.getEndpoints();
      return Boolean(
        isSynthProvider(ttsProviderOf(eps)) && eps.tts_base_url && deps.getActiveSpeaker().id,
      );
    },
  };
}
