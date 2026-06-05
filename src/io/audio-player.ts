/** wav clip을 재생하고 RMS 진폭을 콜백하는 Web Audio sink. */

export interface AudioSink {
  play(wav: ArrayBuffer, onAmplitude?: (rms: number) => void): Promise<void>;
  stop(): void;
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

        const sample = () => {
          if (current !== source) return;
          analyser.getByteTimeDomainData(data);
          if (onAmplitude) {
            let sum = 0;
            for (let i = 0; i < data.length; i++) {
              const v = (data[i] - 128) / 128;
              sum += v * v;
            }
            onAmplitude(Math.sqrt(sum / data.length));
          }
          rafId = requestAnimationFrame(sample);
        };

        source.onended = () => {
          if (current === source) {
            current = null;
            cancelRaf();
          }
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
