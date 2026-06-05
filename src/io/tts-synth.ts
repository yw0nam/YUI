/**
 * tts-synth.ts — per-sentence TTS HTTP call. STUB.
 */

import type { EndpointsConfig } from "../contract";

export interface TtsSynthOptions {
  config: EndpointsConfig;
  fetch?: typeof fetch;
  model?: string;
  voice?: string;
  speed?: number;
}

export type TtsSynth = (input: string, signal?: AbortSignal) => Promise<ArrayBuffer>;

export function createTtsSynth(_opts: TtsSynthOptions): TtsSynth {
  return async () => {
    throw new Error("not implemented");
  };
}
