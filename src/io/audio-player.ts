/** wav clip을 재생하고 입 벌림(0..1) 진폭을 콜백하는 Web Audio sink. */

export interface AudioSink {
  /** onAmplitude는 0..1로 정규화·스무딩된 입 벌림 값을 매 프레임 받는다. */
  play(wav: ArrayBuffer, onAmplitude?: (mouthOpen: number) => void): Promise<void>;
  stop(): void;
}

export interface AmplitudeEnvelopeOptions {
  /** push마다 매핑 목표로 향하는 lerp 비율 (0..1; 1 = snap). */
  smoothing?: number;
  /** 조용한 음성도 입이 벌어지게 raw RMS에 곱하는 게인. */
  gain?: number;
}

/** raw per-frame RMS(≈0..1)를 0..1 입 벌림 값으로 정규화·스무딩하는 순수 스테이지. */
export interface AmplitudeEnvelope {
  /** 한 프레임 RMS를 흘려보내고 스무딩된 입 벌림 값(0..1)을 반환. */
  push(rms: number): number;
  /** 누적 에너지를 0으로 리셋(재생 종료/정지 시). */
  reset(): void;
}

/**
 * 진폭 → 입 벌림 엔벨로프 (#15, PRD D1 amplitude-only).
 * raw RMS를 게인으로 스케일·clamp한 뒤 light smoothing으로 ease한다.
 * raw에 단조 증가(louder in → not quieter out)하며 항상 finite 0..1.
 */
export function createAmplitudeEnvelope(
  options: AmplitudeEnvelopeOptions = {},
): AmplitudeEnvelope {
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
    (typeof (globalThis as any).AudioContext !== "undefined" ||
      typeof (globalThis as any).webkitAudioContext !== "undefined")
  );
}

export function createWebAudioSink(): AudioSink {
  if (!hasAudioContext()) {
    return { async play() {}, stop() {} };
  }

  const Ctor: typeof AudioContext =
    (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext;
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
      // decodeAudioData가 ArrayBuffer를 detach하므로 복사본을 넘긴다.
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

        const envelope = createAmplitudeEnvelope();

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
