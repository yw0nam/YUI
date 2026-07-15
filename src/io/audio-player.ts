/** Web Audio sink that plays a wav clip and calls back with mouth-open (0..1) amplitude. */

const audioGlobal = globalThis as unknown as {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
};

export interface AudioSink {
  /** onAmplitude receives the normalized, smoothed mouth-open value (0..1) every frame. */
  play(wav: ArrayBuffer, onAmplitude?: (mouthOpen: number) => void): Promise<void>;
  stop(): void;
}

export interface AmplitudeEnvelopeOptions {
  /** lerp ratio toward the mapped target on each push (0..1; 1 = snap). */
  smoothing?: number;
  /** Gain multiplied into raw RMS so even quiet audio opens the mouth. */
  gain?: number;
}

/** Pure stage that normalizes and smooths raw per-frame RMS (≈0..1) into a 0..1 mouth-open value. */
export interface AmplitudeEnvelope {
  /** Feeds in one frame's RMS and returns the smoothed mouth-open value (0..1). */
  push(rms: number): number;
  /** Resets accumulated energy to 0 (on playback end/stop). */
  reset(): void;
}

/**
 * Amplitude → mouth-open envelope (amplitude-only).
 * Scales and clamps raw RMS by gain, then eases with light smoothing.
 * Monotonic in raw (louder in → not quieter out) and always finite 0..1.
 */
export function createAmplitudeEnvelope(options: AmplitudeEnvelopeOptions = {}): AmplitudeEnvelope {
  const smoothing = Math.min(1, Math.max(0, options.smoothing ?? 0.4));
  const gain = options.gain ?? 2.0;
  let value = 0;

  const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

  return {
    push(rms) {
      const raw = Number.isFinite(rms) ? rms : 0;
      const targetMouth = clamp01(Math.max(0, raw) * gain);
      value += (targetMouth - value) * smoothing;
      return clamp01(value);
    },
    reset() {
      value = 0;
    },
  };
}

function hasAudioContext(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    (typeof audioGlobal.AudioContext !== "undefined" ||
      typeof audioGlobal.webkitAudioContext !== "undefined")
  );
}

export function createWebAudioSink(opts?: { getGain?: () => number }): AudioSink {
  if (!hasAudioContext()) {
    return { async play() {}, stop() {} };
  }

  const Ctor: typeof AudioContext = (audioGlobal.AudioContext ?? audioGlobal.webkitAudioContext)!;
  let ctx: AudioContext | null = null;
  let current: AudioBufferSourceNode | null = null;
  let rafId: number | null = null;

  function ensureCtx(): AudioContext {
    if (!ctx) ctx = new Ctor();
    return ctx;
  }

  function cancelRaf(): void {
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  return {
    async play(wav, onAmplitude) {
      const audioCtx = ensureCtx();
      // decodeAudioData detaches the ArrayBuffer, so pass a copy.
      const buffer = await audioCtx.decodeAudioData(wav.slice(0));

      return new Promise<void>((resolve) => {
        const source = audioCtx.createBufferSource();
        source.buffer = buffer;

        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        const data = new Uint8Array(analyser.fftSize);

        source.connect(analyser);
        analyser.connect(audioCtx.destination);

        current = source;

        const envelope = createAmplitudeEnvelope({ gain: opts?.getGain?.() });

        const sample = () => {
          if (current !== source) return;
          analyser.getByteTimeDomainData(data);
          if (onAmplitude) {
            let sum = 0;
            for (let i = 0; i < data.length; i++) {
              const v = (data[i] - 128) / 128;
              sum += v * v;
            }
            const rms = Math.sqrt(sum / data.length);
            onAmplitude(envelope.push(rms));
          }
          rafId = requestAnimationFrame(sample);
        };

        source.onended = () => {
          if (current === source) {
            current = null;
            cancelRaf();
          }
          envelope.reset();
          resolve();
        };

        source.start();
        rafId = requestAnimationFrame(sample);
      });
    },

    stop() {
      cancelRaf();
      if (current) {
        const s = current;
        current = null;
        try {
          s.stop();
        } catch {
          /* already stopped */
        }
      }
    },
  };
}
