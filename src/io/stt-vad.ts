/**
 * STT + VAD — voice input pipeline.
 *
 * Responsibilities:
 *  - VAD (@ricky0123/vad-web, Silero+ONNX) detects speech start/end.
 *  - On speech end: encode Float32Array → WAV blob → POST to STT service.
 *  - Forward transcript to caller via onVoiceSegment.
 *
 * Voice mode is OFF by default. Call start() to activate.
 */

import { MicVAD } from "@ricky0123/vad-web";
import type { EndpointsConfig } from "../contract";
import { createLogger } from "../logger";
import type { VoiceInputState } from "../ui/voice-input-status";
import { createDeadlineSignal } from "./deadline";

const log = createLogger("stt-vad");

export type SttVadRuntimeState = Exclude<VoiceInputState, "idle">;

const VAD_ASSET_PATH = "/vad/";

// Deadline so a hung STT request settles instead of silently discarding the captured utterance forever.
// Magnitude mirrors tts-synth's TTS_SYNTH_TIMEOUT_MS, itself sized off irodori-synth's RETRY_AFTER_CAP_MS (5s).
export const STT_REQUEST_TIMEOUT_MS = 10_000;

export interface SttVadOptions {
  config: EndpointsConfig;
  /**
   * Silence window in ms before speech end is declared. Default 1500.
   * Accepts a getter so a live setting is read at each start(), not pinned at construction.
   */
  silenceMs?: number | (() => number);
  /** Called once per completed voice segment after STT succeeds. */
  onVoiceSegment: (text: string) => void;
  /** Reports client-side voice pipeline state for runtime UI. */
  onState?: (state: SttVadRuntimeState, detail?: string) => void;
  /**
   * Fires when a sustained utterance begins (past minSpeechFrames) — the barge-in trigger.
   * Distinct from onState('listening') which fires on raw speech-start.
   */
  onSpeechActive?: () => void;
  /** Resolves the STT server key (Bearer) per request. Omitted/empty → no auth header. */
  getApiKey?: () => Promise<string | undefined>;
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
  const { config, onVoiceSegment, onState, getApiKey, onSpeechActive } = options;
  const resolveSilenceMs = (): number =>
    typeof options.silenceMs === "function" ? options.silenceMs() : (options.silenceMs ?? 1500);

  let vad: Awaited<ReturnType<typeof MicVAD.new>> | null = null;
  let loading = false;
  let startPromise: Promise<void> | null = null;
  // Set by stop()/dispose() when they land during an in-flight load, so the load
  // can apply the requested outcome once MicVAD.new settles instead of racing it.
  let stopRequested = false;
  let disposeRequested = false;

  async function onSpeechEnd(audio: Float32Array): Promise<void> {
    onState?.("asr");
    const wav = encodeWav(audio);
    const form = new FormData();
    form.append("file", wav, "audio.wav");

    const deadline = createDeadlineSignal(STT_REQUEST_TIMEOUT_MS, "STT request timed out");
    try {
      // Bearer only — never set Content-Type here: FormData needs the browser-set multipart boundary.
      const key = (await getApiKey?.())?.trim() || undefined;
      const res = await fetch(`${config.stt_base_url}/audio/transcriptions`, {
        method: "POST",
        body: form,
        headers: key ? { Authorization: `Bearer ${key}` } : undefined,
        signal: deadline.signal,
      });
      if (!res.ok) {
        log.warn("stt_request_failed", { status: res.status });
        onState?.("error", `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { text: string };
      onVoiceSegment(data.text);
      onState?.("fired");
    } catch (err) {
      log.warn("stt_error", { error: String(err) });
      const detail = err instanceof Error ? err.message : "STT request failed";
      onState?.("error", detail);
    } finally {
      deadline.clear();
    }
  }

  function load(): Promise<void> {
    loading = true;
    stopRequested = false;
    disposeRequested = false;
    return (async () => {
      try {
        const instance = await MicVAD.new({
          redemptionMs: resolveSilenceMs(),
          baseAssetPath: VAD_ASSET_PATH,
          onnxWASMBasePath: VAD_ASSET_PATH,
          onSpeechStart: () => onState?.("listening"),
          onSpeechRealStart: () => onSpeechActive?.(),
          onSpeechEnd,
        });
        if (disposeRequested) {
          await instance.destroy();
          return;
        }
        vad = instance;
        if (stopRequested) return; // stop() landed mid-load — leave it paused, don't start
        await vad.start();
      } catch (err) {
        // getUserMedia / VAD asset load can fail (e.g. denied mic permission); surface it instead of throwing.
        log.warn("start_failed", { error: String(err) });
        vad = null;
        onState?.("error", describeStartError(err));
      } finally {
        loading = false;
        startPromise = null;
      }
    })();
  }

  return {
    start(): Promise<void> {
      // Without stt_base_url, STT is unavailable — silently no-op.
      if (!config.stt_base_url) return Promise.resolve();
      if (vad !== null || loading) return startPromise ?? Promise.resolve();
      startPromise = load();
      return startPromise;
    },

    stop() {
      if (loading) {
        stopRequested = true;
        return;
      }
      vad?.pause();
    },

    async dispose() {
      if (loading) {
        disposeRequested = true;
        await startPromise;
        return;
      }
      if (vad) {
        await vad.destroy();
        vad = null;
      }
    },
  };
}
