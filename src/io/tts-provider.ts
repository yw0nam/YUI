/**
 * TtsProvider — one adapter interface over the openai-compatible/irodori TTS synthesis paths.
 * `selectProvider` is the single point that branches on `tts_provider`; every other caller
 * (voice pipeline, broker, reflect) goes through the interface instead of comparing strings.
 */

export type TtsSynth = (input: string, signal?: AbortSignal) => Promise<ArrayBuffer>;

export type TtsProviderKind = "irodori" | "openai";

export interface TtsProvider {
  synth: TtsSynth;
  /** Everything that changes the rendered audio, as one comparable string. */
  paramsKey(): string;
  /** Whether this provider has enough live config to synthesize right now. */
  isReady(): boolean;
  /** emotion_text vocabulary shape this provider's TTS voice tag takes (docs/reference/tts-emotion). */
  emotionTextMode(): "enum" | "free";
}

// Deadline so a hung request settles instead of stalling the turn's ordered playback forever.
// Shared by both adapters. Magnitude has headroom for irodori's 503 retry (capped at 5s) plus
// network + synth time.
export const TTS_SYNTH_TIMEOUT_MS = 10_000;

/** "unset means irodori" — the one place this default is decided. */
export function resolveTtsProviderKind(raw: string | undefined): TtsProviderKind {
  return raw === "openai" ? "openai" : "irodori";
}

export function isTtsProviderKind(v: string | undefined): v is TtsProviderKind {
  return v === "irodori" || v === "openai";
}

/** emotion_text vocabulary mode for a resolved provider kind (docs/reference/tts-emotion). */
export function emotionTextModeFor(kind: TtsProviderKind): "enum" | "free" {
  return kind === "irodori" ? "enum" : "free";
}

/** The single selection point: which adapter answers for the configured tts_provider. */
export function selectProvider(
  endpoints: { tts_provider?: string },
  providers: { irodori: TtsProvider; openai: TtsProvider },
): TtsProvider {
  return resolveTtsProviderKind(endpoints.tts_provider) === "irodori"
    ? providers.irodori
    : providers.openai;
}
