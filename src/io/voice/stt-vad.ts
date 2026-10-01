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
import type { EndpointsConfig } from "../../contract";
import { createLogger } from "../../logger";
import { createDeadlineSignal, untilAborted } from "./deadline";
import type { MicErrorCode } from "./mic-error";

const log = createLogger("stt-vad");

export type VoiceInputState = "idle" | "listening" | "asr" | "fired" | "error";

type SttVadRuntimeState = Exclude<VoiceInputState, "idle">;

const VAD_ASSET_PATH = "/vad/";

// The constraints @ricky0123/vad-web asks getUserMedia for by default.
const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { channelCount: 1, echoCancellation: true, autoGainControl: true, noiseSuppression: true },
};

function releaseTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

// Deadline so a hung STT request settles instead of silently discarding the captured utterance forever.
// Magnitude mirrors tts-synth's TTS_SYNTH_TIMEOUT_MS.
export const STT_REQUEST_TIMEOUT_MS = 10_000;

export interface SttVadOptions {
  /** A getter, so a live stt_base_url override is read on every request rather than pinned at construction. */
  config: () => EndpointsConfig;
  fetch?: typeof fetch;
  /**
   * Silence window in ms before speech end is declared. Default 1500.
   * A getter, so a live setting is read at each start() rather than pinned at construction.
   */
  silenceMs?: () => number;
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
  /**
   * Load VAD and start listening (idempotent). Resolves once capture runs, or once a stop() or
   * dispose() that landed first has cancelled it; rejects with the failure's detail as the message.
   */
  start(): Promise<void>;
  /** Pause listening without releasing resources; a transcription still in flight is dropped. */
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

const MIC_ERROR_BY_NAME: Record<string, MicErrorCode> = {
  NotAllowedError: "mic_denied",
  SecurityError: "mic_denied",
  NotFoundError: "no_mic",
  DevicesNotFoundError: "no_mic",
  NotReadableError: "mic_unavailable",
};

/** Map a start() failure to a stable cause code, or to its message when it is not a mic cause. */
function describeStartError(err: unknown): string {
  const code = err instanceof DOMException ? MIC_ERROR_BY_NAME[err.name] : undefined;
  if (code) return code;
  const message = err instanceof Error ? err.message : "";
  return message ? `Voice init failed: ${message}` : "Voice init failed";
}

export function createSttVad(options: SttVadOptions): SttVad {
  const { config, onVoiceSegment, onState, getApiKey, onSpeechActive } = options;
  const fetchImpl = options.fetch ?? globalThis.fetch;

  let vad: Awaited<ReturnType<typeof MicVAD.new>> | null = null;
  let startPromise: Promise<void> | null = null;
  // The stream acquired for the VAD's next getStream/resumeStream call.
  let handoff: MediaStream | null = null;
  let capturing = false;
  // The latest start()/stop() outcome the caller asked for; a load or capture in flight applies it when it lands.
  let wanted = false;
  // Bumped by stop() and dispose(): a transcription that began under an older value is dropped.
  let generation = 0;

  async function onSpeechEnd(audio: Float32Array): Promise<void> {
    const segmentGeneration = generation;
    const stale = (): boolean => segmentGeneration !== generation;
    onState?.("asr");
    const wav = encodeWav(audio);
    const form = new FormData();
    form.append("file", wav, "audio.wav");

    const deadline = createDeadlineSignal(STT_REQUEST_TIMEOUT_MS, "STT request timed out");
    try {
      // Bearer only — never set Content-Type here: FormData needs the browser-set multipart boundary.
      const key = (await getApiKey?.())?.trim() || undefined;
      const cfg = config();
      if (cfg.stt_model) form.append("model", cfg.stt_model);
      const res = await fetchImpl(`${cfg.stt_base_url}/audio/transcriptions`, {
        method: "POST",
        body: form,
        headers: key ? { Authorization: `Bearer ${key}` } : undefined,
        signal: deadline.signal,
      });
      if (stale()) return;
      if (!res.ok) {
        log.warn("stt_request_failed", { status: res.status });
        onState?.("error", `HTTP ${res.status}`);
        return;
      }
      const data = (await untilAborted(res.json(), deadline.signal)) as { text: string };
      if (stale()) return;
      onVoiceSegment(data.text);
      onState?.("fired");
    } catch (err) {
      if (stale()) return;
      // The Tauri transport rejects with its own cancel error; the deadline's reason names the timeout.
      const cause = deadline.signal.aborted ? deadline.signal.reason : err;
      log.warn("stt_error", { error: String(cause) });
      const detail = cause instanceof Error ? cause.message : "STT request failed";
      onState?.("error", detail);
    } finally {
      deadline.clear();
    }
  }

  function takeStream(): Promise<MediaStream> {
    const taken = handoff;
    handoff = null;
    return taken ? Promise.resolve(taken) : Promise.reject(new Error("no mic stream handed over"));
  }

  /** Drops a MicVAD that failed to start: an errored instance ignores later starts. */
  async function discard(instance: NonNullable<typeof vad>): Promise<void> {
    vad = null;
    try {
      await instance.destroy();
    } catch (err) {
      log.debug("discard_failed", { error: String(err) });
    }
  }

  async function run(): Promise<void> {
    try {
      if (vad === null) {
        vad = await MicVAD.new({
          redemptionMs: options.silenceMs?.() ?? 1500,
          baseAssetPath: VAD_ASSET_PATH,
          onnxWASMBasePath: VAD_ASSET_PATH,
          startOnLoad: false,
          // The wrapper acquires the stream, so a denied prompt never reaches the instance.
          getStream: takeStream,
          resumeStream: takeStream,
          onSpeechStart: () => onState?.("listening"),
          onSpeechRealStart: () => onSpeechActive?.(),
          onSpeechEnd,
        });
      }
      if (!wanted || capturing) return;
      const instance = vad;
      const acquired = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      if (!wanted) {
        releaseTracks(acquired);
        return;
      }
      handoff = acquired;
      try {
        await instance.start();
      } catch (err) {
        handoff = null;
        releaseTracks(acquired);
        await discard(instance);
        throw err;
      }
      capturing = true;
      // stop() landed while capture was starting; the pause releases it.
      if (!wanted) {
        capturing = false;
        void instance.pause();
      }
    } catch (err) {
      // getUserMedia / VAD asset load can fail (e.g. denied mic permission); surface the cause.
      log.warn("start_failed", { error: String(err) });
      const detail = describeStartError(err);
      onState?.("error", detail);
      throw new Error(detail);
    }
  }

  return {
    start(): Promise<void> {
      // Without stt_base_url, STT is unavailable — silently no-op.
      if (!config().stt_base_url) return Promise.resolve();
      wanted = true;
      // MicVAD.start() is itself idempotent (no-ops if already listening) and resumes cleanly from a
      // paused state, so a loaded instance is reused instead of reloaded.
      startPromise ??= run().finally(() => {
        startPromise = null;
      });
      return startPromise;
    },

    stop() {
      wanted = false;
      generation++;
      if (startPromise === null) {
        capturing = false;
        void vad?.pause();
      }
    },

    async dispose() {
      wanted = false;
      generation++;
      await startPromise?.catch(() => {});
      if (vad) {
        const instance = vad;
        vad = null;
        capturing = false;
        await instance.destroy().catch((err: unknown) => {
          log.debug("destroy_failed", { error: String(err) });
        });
      }
    },
  };
}
