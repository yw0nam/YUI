/**
 * audio-player.ts — browser Web Audio sink (PRD F4 / contract.md §3 step 6-7).
 *
 * 이 모듈만 브라우저 Web Audio API에 의존한다(다른 io 모듈은 순수/주입 fetch). jsdom엔
 * AudioContext가 없어 단위 테스트에서 제외되며, 대신 AudioSink 인터페이스를 pipeline에 주입해
 * pipeline 자체는 fake sink로 완전히 테스트 가능하게 한다(emotion-resolver pure/impure 분리와 동형).
 *
 * play(wav): decodeAudioData → AudioBufferSourceNode → AnalyserNode → destination. 재생 중
 *   rAF로 RMS를 샘플해 onAmplitude(rms) 호출(립싱크 hook, mouth blendshape wiring은 #15).
 *   해당 clip이 끝나면 resolve.
 * stop(): 현재 source 중단 + rAF 취소.
 */

export interface AudioSink {
  /** wav 한 clip 재생. clip이 끝나면 resolve. 재생 중 onAmplitude(rms 0~1)를 주기적 호출. */
  play(wav: ArrayBuffer, onAmplitude?: (rms: number) => void): Promise<void>;
  /** 현재 재생 중단 + 진폭 샘플링 취소. */
  stop(): void;
}

/** SSR/test 가드 — AudioContext가 없는 환경에서 no-op sink. */
function hasAudioContext(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    (typeof (globalThis as any).AudioContext !== "undefined" ||
      typeof (globalThis as any).webkitAudioContext !== "undefined")
  );
}

export function createWebAudioSink(): AudioSink {
  if (!hasAudioContext()) {
    // AudioContext 없음(SSR/test) — 즉시 resolve하는 no-op. fail-loud 대신 graceful degrade.
    return {
      async play() {},
      stop() {},
    };
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
      // decodeAudioData는 ArrayBuffer를 detach할 수 있어 복사본을 넘긴다.
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
          if (current !== source) return; // 교체/중단됨.
          analyser.getByteTimeDomainData(data);
          if (onAmplitude) {
            // RMS(0~1): 128 중심에서 벗어난 정도.
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
          // 이미 끝났거나 시작 전 — 무시.
        }
      }
    },
  };
}
