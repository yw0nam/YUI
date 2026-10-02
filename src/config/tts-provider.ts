import type { EndpointsConfig, TtsProviderName } from "../contract";

/** Every value `tts_provider` accepts. */
export const TTS_PROVIDERS = [
  "irodori",
  "openai",
  "fish",
] as const satisfies readonly TtsProviderName[];

/** The TTS engine the endpoints select — Irodori when they name none. */
export function ttsProviderOf(eps: Pick<EndpointsConfig, "tts_provider">): TtsProviderName {
  return eps.tts_provider ?? "irodori";
}
