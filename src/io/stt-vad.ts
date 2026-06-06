/**
 * STT + VAD — voice input pipeline (PRD F3 / concept.md §2.C).
 *
 * Responsibilities:
 *  - VAD (@ricky0123/vad-web, Silero+ONNX) detects speech start/end.
 *  - On speech end: encode Float32Array → WAV blob → POST to STT service.
 *  - Forward transcript to caller via onVoiceSegment.
 *
 * Voice mode is OFF by default. Call start() to activate.
 */

import { MicVAD } from "@ricky0123/vad-web";
import type { EndpointsConfig, InputContext } from "../contract";
import { createLogger } from "../logger";

const log = createLogger("stt-vad");

/** STT result — matches contract.md §4 InputContext.transcript. */
export type Transcript = NonNullable<InputContext["transcript"]>;
export type SttVadRuntimeState = "listening" | "asr" | "fired" | "error";

const VAD_ASSET_PATH = "/vad/";

export interface SttVadOptions {
  config: EndpointsConfig;
  /** Silence window in ms before speech end is declared. Default 1500. */
  silenceMs?: number;
  /** Called once per completed voice segment after STT succeeds. */
  onVoiceSegment: (transcript: Transcript) => void;
  /** Reports client-side voice pipeline state for runtime UI. */
  onState?: (state: SttVadRuntimeState, detail?: string) => void;
}

export interface SttVad {
  /** Load VAD and start listening (idempotent). */
  start(): Promise<void>;
  /** Pause listening without releasing resources. */
  stop(): void;
  /** Destroy VAD instance and release ONNX session. */
  dispose(): Promise<void>;
}

/** Encode Float32Array PCM (16 kHz, mono) to a WAV Blob. */
function encodeWav(samples: Float32Array): Blob {
  const sampleRate = 16000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = samples.length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

/** Map a start() failure to a human-readable, cause-distinguishable detail. */
function describeStartError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Microphone permission denied";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No microphone device found";
    case "NotReadableError":
      return "Microphone is in use by another app";
  }
  const message = err instanceof Error ? err.message : "";
  return message ? `Voice init failed: ${message}` : "Voice init failed";
}

export function createSttVad(options: SttVadOptions): SttVad {
  const { config, onVoiceSegment, onState } = options;
  const silenceMs = options.silenceMs ?? 1500;

  let vad: Awaited<ReturnType<typeof MicVAD.new>> | null = null;
  let loading = false;

  async function onSpeechEnd(audio: Float32Array): Promise<void> {
    onState?.("asr");
    const wav = encodeWav(audio);
    const form = new FormData();
    form.append("file", wav, "audio.wav");

    try {
      const res = await fetch(`${config.stt_base_url}/audio/transcriptions`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        log.warn(`STT request failed: HTTP ${res.status}`);
        onState?.("error", `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { text: string };
      onVoiceSegment({ text: data.text });
      onState?.("fired");
    } catch (err) {
      log.warn("STT error:", err);
      const detail = err instanceof Error ? err.message : "STT request failed";
      onState?.("error", detail);
    }
  }

  return {
    async start() {
      if (vad !== null || loading) return;
      loading = true;
      try {
        vad = await MicVAD.new({
          redemptionMs: silenceMs,
          baseAssetPath: VAD_ASSET_PATH,
          onnxWASMBasePath: VAD_ASSET_PATH,
          onSpeechStart: () => onState?.("listening"),
          onSpeechEnd,
        });
        await vad.start();
      } catch (err) {
        // getUserMedia / VAD asset load can fail (e.g. denied mic permission); surface it instead of throwing.
        log.warn("start failed:", err);
        vad = null;
        onState?.("error", describeStartError(err));
      } finally {
        loading = false;
      }
    },

    stop() {
      vad?.pause();
    },

    async dispose() {
      if (vad) {
        await vad.destroy();
        vad = null;
      }
    },
  };
}
