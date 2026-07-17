import type { AppConfig } from "./config/load";
import type { EndpointsConfig } from "./contract";
import { createWebAudioSink } from "./io/audio-player";
import { selectFetch } from "./io/chat-client";
import { createFillerLoop, type FillerLoop } from "./io/filler-loop";
import { effectiveFillerPool } from "./io/filler-pool";
import type { FillerSettings } from "./io/filler-settings";
import { createIrodoriSynth, type TtsSynth } from "./io/irodori-synth";
import { createIrodoriSynthFactory } from "./io/irodori-synth-factory";
import { ensureRegistered, evictRegistration } from "./io/irodori-voices";
import type { SpeakerOption } from "./io/speaker-selection";
import { createSpeechPlayback, type SpeechPlayback } from "./io/speech-playback";
import type { SttVad } from "./io/stt-vad";
import { TTS_SKIP } from "./io/tts-pipeline";
import { createTtsSynth } from "./io/tts-synth";
import type { Renderer } from "./renderer";
import type { Surfaces } from "./ui/surfaces";
import type { VoiceInputStatus } from "./ui/voice-input-status";

type VoiceRenderer = Pick<
  Renderer,
  "setMouthOpen" | "stopMouth" | "easeEmotionToNeutral" | "applyDirective" | "playMotion"
>;

type VoiceSurfaces = Pick<Surfaces, "beginSpeech" | "pushSpeech" | "endSpeech" | "finishSpeech">;

export interface VoicePipelineDeps {
  renderer: VoiceRenderer;
  surfaces: VoiceSurfaces;
  getEndpoints: () => EndpointsConfig;
  getFillerConfig: () => AppConfig["filler"];
  getTtsApiKey: () => Promise<string | undefined>;
  getSttApiKey: () => Promise<string | undefined>;
  ttsSettings: { get(): { enabled: boolean } };
  lipsyncSettings: { get(): { gain: number } };
  fillerSettings: { get(): FillerSettings };
  vadSettings: { get(): { silenceMs: number; bargeIn: boolean } };
  speakerSelection: { getActive(): SpeakerOption };
  voiceInputStatus: Pick<VoiceInputStatus, "set">;
  onVoiceSegment: (text: string) => void;
}

export interface VoicePipeline {
  speechPlayback: SpeechPlayback;
  hasFiller: () => boolean;
  onThinkingStart: (token: object) => void;
  onThinkingEnd: (token: object) => void;
  createSttEngine: (endpoints: EndpointsConfig) => Promise<SttVad>;
  dispose: () => void;
}

/**
 * Voice-pipeline core: TTS synth selection (irodori/openai-compatible), speech playback,
 * TTFT filler loop, thinking-turn handlers, and the STT/VAD engine factory incl. barge-in.
 * All config/settings reads are lazy (call-time) so hot-reload and slider edits take effect
 * without rewiring. The caller registers HMR teardown via the returned dispose().
 */
export function wireVoicePipeline(deps: VoicePipelineDeps): VoicePipeline {
  // irodori synth closure memoized per speaker/tuning keys + 422 self-heal. Not reconstructed per sentence.
  let irodoriFactory: TtsSynth | undefined;
  const irodoriSynth = async (input: string, signal?: AbortSignal): Promise<ArrayBuffer> => {
    const f = await selectFetch();
    irodoriFactory ??= createIrodoriSynthFactory({
      getParams: () => {
        const eps = deps.getEndpoints();
        const active = deps.speakerSelection.getActive();
        if (!eps.irodori_base_url || !active.id) {
          throw new Error("irodori provider requires irodori_base_url + irodori_speaker");
        }
        return {
          baseUrl: eps.irodori_base_url,
          referenceId: active.id,
          refUrl: active.ref_url,
          numSteps: eps.irodori_num_steps,
          cfgScaleText: eps.irodori_cfg_scale_text,
          cfgScaleSpeaker: eps.irodori_cfg_scale_speaker,
          seconds: eps.irodori_seconds,
        };
      },
      ensureRegistered,
      evictRegistration,
      buildSynth: (p, fetchImpl) =>
        createIrodoriSynth({
          baseUrl: p.baseUrl,
          referenceId: p.referenceId,
          fetch: fetchImpl,
          numSteps: p.numSteps,
          cfgScaleText: p.cfgScaleText,
          cfgScaleSpeaker: p.cfgScaleSpeaker,
          seconds: p.seconds,
        }),
      fetch: f ?? globalThis.fetch,
    });
    return irodoriFactory(input, signal);
  };

  // Filler loop speaks via speechPlayback (speak), playback completion (onPlaybackEnd) triggers
  // the loop's next iteration — mutual reference, break the cycle with a forward let.
  let fillerLoop: FillerLoop | undefined;
  // Token of the turn owning current thinking — late onThinkingEnd of an overtaken turn must not
  // clean up the single fillerLoop/motion, so ignore it when the token differs.
  let currentThinkingTurn: object | null = null;
  const speechPlayback = createSpeechPlayback({
    renderer: deps.renderer,
    surfaces: deps.surfaces,
    onPlaybackEnd: () => fillerLoop?.onUtteranceDone(),
    pipeline: {
      sink: createWebAudioSink({ getGain: () => deps.lipsyncSettings.get().gain }),
      maxInflight: () => deps.getEndpoints().tts_max_inflight ?? 1,
      synth: async (input, signal) => {
        // TTS inactive (toggle OFF or server unset) quietly skips — expressions/motions, bubble unchanged.
        if (!deps.ttsSettings.get().enabled) return Promise.reject(TTS_SKIP);
        const eps = deps.getEndpoints();
        if (eps.tts_provider === "irodori") {
          if (!eps.irodori_base_url || !deps.speakerSelection.getActive().id) {
            return Promise.reject(TTS_SKIP);
          }
          return irodoriSynth(input, signal);
        }
        if (!eps.tts_base_url) return Promise.reject(TTS_SKIP);
        const f = await selectFetch();
        return createTtsSynth({
          config: eps,
          fetch: f,
          model: eps.tts_model,
          voice: eps.tts_voice,
          speed: eps.tts_speed,
          getApiKey: deps.getTtsApiKey,
        })(input, signal);
      },
    },
  });

  const effectiveFiller = () =>
    effectiveFillerPool(deps.fillerSettings.get(), deps.getFillerConfig());

  fillerLoop = createFillerLoop({
    speak: (text) => speechPlayback.onSpeech(text),
    getPools: effectiveFiller,
    getTiming: () => ({
      gapMs: deps.getFillerConfig().gap_ms,
      jitterMs: deps.getFillerConfig().gap_jitter_ms,
    }),
  });

  function hasFiller(): boolean {
    const pool = effectiveFiller();
    return pool.first.length > 0 || pool.repeat.length > 0;
  }

  function onThinkingStart(token: object): void {
    currentThinkingTurn = token;
    // hold BEFORE the first filler can speak so no filler sentence resets the motion.
    speechPlayback.holdMotion(true);
    deps.renderer.playMotion({ id: "thinking", loop: true });
    fillerLoop?.start();
  }

  function onThinkingEnd(token: object): void {
    if (token !== currentThinkingTurn) return;
    currentThinkingTurn = null;
    speechPlayback.holdMotion(false);
    fillerLoop?.stop();
    // thinking is loop:true — without an explicit return to idle it spins forever and pollutes previousStable.
    deps.renderer.playMotion(null);
  }

  async function createSttEngine(endpoints: EndpointsConfig): Promise<SttVad> {
    const { createSttVad } = await import("./io/stt-vad");
    return createSttVad({
      config: endpoints,
      silenceMs: () => deps.vadSettings.get().silenceMs,
      getApiKey: deps.getSttApiKey,
      onVoiceSegment: deps.onVoiceSegment,
      onState: (state, detail) => deps.voiceInputStatus.set(state, detail),
      onSpeechActive: () => {
        if (deps.vadSettings.get().bargeIn && speechPlayback.isSpeaking()) {
          speechPlayback.interrupt({ muteCurrentTurn: true });
        }
      },
    });
  }

  return {
    speechPlayback,
    hasFiller,
    onThinkingStart,
    onThinkingEnd,
    createSttEngine,
    dispose() {
      fillerLoop?.stop();
      speechPlayback.dispose();
    },
  };
}
