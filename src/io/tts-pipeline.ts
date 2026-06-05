/**
 * tts-pipeline.ts — client-side 발화 파이프라인 orchestration. STUB.
 */

import type { EndpointsConfig } from "../contract";
import type { AudioSink } from "./audio-player";
import type { TtsSynth } from "./tts-synth";

export interface TtsPipelineOptions {
  config: EndpointsConfig;
  synth?: TtsSynth;
  sink?: AudioSink;
  fetch?: typeof fetch;
  onAmplitude?: (rms: number) => void;
}

export interface TtsPipeline {
  pushTextDelta(token: string): void;
  setEmotionText(text: string | null): void;
  end(): void;
  dispose(): void;
}

export function createTtsPipeline(_options: TtsPipelineOptions): TtsPipeline {
  return {
    pushTextDelta() {},
    setEmotionText() {},
    end() {},
    dispose() {},
  };
}
