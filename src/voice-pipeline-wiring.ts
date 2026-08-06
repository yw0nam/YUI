import type { AppConfig } from "./config/load";
import type { EndpointsConfig } from "./contract";
import type { TurnLog } from "./dispatcher/turn";
import type { TurnOutput } from "./dispatcher/turn-output";
import { createWebAudioSink } from "./io/audio-player";
import { selectFetch } from "./io/chat-client";
import { createFillerAudioCache } from "./io/filler-audio-cache";
import { createFillerLoop, type FillerLoop } from "./io/filler-loop";
import { effectiveFillerPool } from "./io/filler-pool";
import type { FillerSettings } from "./io/filler-settings";
import { createIrodoriSynth, type TtsSynth } from "./io/irodori-synth";
import {
  createIrodoriSynthFactory,
  type IrodoriSynthParams,
  irodoriParamsKey,
} from "./io/irodori-synth-factory";
import { ensureRegistered, evictRegistration, voiceRevision } from "./io/irodori-voices";
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

interface VoicePipelineDeps {
  renderer: VoiceRenderer;
  surfaces: VoiceSurfaces;
  turnLog: TurnLog;
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
  turnOutput: TurnOutput;
  createSttEngine: (endpoints: EndpointsConfig) => Promise<SttVad>;
  dispose: () => void;
}

/**
 * Voice-pipeline core: TTS synth selection (irodori/openai-compatible) with a session-scoped filler
 * audio cache, speech playback, TTFT filler loop, thinking-turn handlers, and the STT/VAD engine
 * factory incl. barge-in.
 * All config/settings reads are lazy (call-time) so hot-reload and slider edits take effect
 * without rewiring. The caller registers HMR teardown via the returned dispose().
 */
export function wireVoicePipeline(deps: VoicePipelineDeps): VoicePipeline {
  const irodoriParams = (): IrodoriSynthParams => {
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
  };

  // irodori synth closure memoized per speaker/tuning keys + 422 self-heal. Not reconstructed per sentence.
  let irodoriFactory: TtsSynth | undefined;
  const irodoriSynth = async (input: string, signal?: AbortSignal): Promise<ArrayBuffer> => {
    const f = await selectFetch();
    irodoriFactory ??= createIrodoriSynthFactory({
      getParams: irodoriParams,
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

  const effectiveFiller = () =>
    effectiveFillerPool(deps.fillerSettings.get(), deps.getFillerConfig());

  // The provider settings that change the rendered audio. The irodori voice revision is part of it
  // because an import over an existing name replaces the clip without changing the speaker id.
  const ttsParamsKey = (): string => {
    const eps = deps.getEndpoints();
    if (eps.tts_provider === "irodori") {
      const params = irodoriParams();
      const revision = voiceRevision(params.baseUrl, params.referenceId);
      return `irodori::${irodoriParamsKey(params)}::${revision}`;
    }
    return ["openai", eps.tts_base_url, eps.tts_model, eps.tts_voice, eps.tts_speed].join("::");
  };

  const cachedSynth = createFillerAudioCache({
    synth: async (input, signal) => {
      const eps = deps.getEndpoints();
      if (eps.tts_provider === "irodori") return irodoriSynth(input, signal);
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
    // The pipeline synthesizes trimmed sentences; a cue-tagged or multi-sentence phrase simply misses.
    isFiller: (text) => {
      const pool = effectiveFiller();
      return (
        pool.first.some((phrase) => phrase.trim() === text) ||
        pool.repeat.some((phrase) => phrase.trim() === text)
      );
    },
    // Everything that changes the rendered audio or the set of cacheable phrases. Audio held under
    // an older key is dropped, which is also what keeps the map to the current pool.
    paramsKey: () => {
      const pool = effectiveFiller();
      return [ttsParamsKey(), ...pool.first, ...pool.repeat].join("\n");
    },
  });

  // Skip guards stay outside the cache so a cached phrase can never outlive the reason to stay silent.
  const synth = async (input: string, signal?: AbortSignal): Promise<ArrayBuffer> => {
    // TTS inactive (toggle OFF or server unset) quietly skips — expressions/motions, bubble unchanged.
    if (!deps.ttsSettings.get().enabled) return Promise.reject(TTS_SKIP);
    const eps = deps.getEndpoints();
    if (eps.tts_provider === "irodori") {
      if (!eps.irodori_base_url || !deps.speakerSelection.getActive().id) {
        return Promise.reject(TTS_SKIP);
      }
    } else if (!eps.tts_base_url) {
      return Promise.reject(TTS_SKIP);
    }
    return cachedSynth(input, signal);
  };

  // Filler loop speaks via speechPlayback (speak), playback completion (onPlaybackEnd) triggers
  // the loop's next iteration — mutual reference, break the cycle with a forward let.
  let fillerLoop: FillerLoop | undefined;
  // Id of the turn owning current thinking — late onThinkingEnd of an overtaken turn must not
  // clean up the single fillerLoop/motion, so ignore it when the id differs.
  let thinkingTurnId: number | null = null;
  const speechPlayback = createSpeechPlayback({
    renderer: deps.renderer,
    surfaces: deps.surfaces,
    onPlaybackEnd: () => fillerLoop?.onUtteranceDone(),
    reportAudioOwed: (owed) => deps.turnLog.setAudioOwed(owed),
    pipeline: {
      sink: createWebAudioSink({ getGain: () => deps.lipsyncSettings.get().gain }),
      maxInflight: () => deps.getEndpoints().tts_max_inflight ?? 1,
      synth,
    },
  });

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

  function onThinkingStart(turnId: number): void {
    thinkingTurnId = turnId;
    // hold BEFORE the first filler can speak so no filler sentence resets the motion.
    speechPlayback.holdMotion(true);
    deps.renderer.playMotion({ id: "thinking", loop: true });
    fillerLoop?.start();
  }

  function onThinkingEnd(turnId: number): void {
    if (turnId !== thinkingTurnId) return;
    thinkingTurnId = null;
    speechPlayback.holdMotion(false);
    fillerLoop?.stop();
    // thinking is loop:true — without an explicit return to idle it spins forever and pollutes previousStable.
    deps.renderer.playMotion(null);
  }

  const turnOutput: TurnOutput = {
    interrupt: () => speechPlayback.interrupt(),
    hasFiller,
    thinkingStart: onThinkingStart,
    thinkingEnd: onThinkingEnd,
    delta: (text) => speechPlayback.onSpeechDelta(text),
    speak: (text) => speechPlayback.onSpeech(text),
    end: () => speechPlayback.onSpeechEnd(),
    abort: () => speechPlayback.abort(),
    cue: (args) => speechPlayback.setCue(args),
  };

  async function createSttEngine(endpoints: EndpointsConfig): Promise<SttVad> {
    const { createSttVad } = await import("./io/stt-vad");
    return createSttVad({
      config: endpoints,
      silenceMs: () => deps.vadSettings.get().silenceMs,
      getApiKey: deps.getSttApiKey,
      onVoiceSegment: deps.onVoiceSegment,
      onState: (state, detail) => deps.voiceInputStatus.set(state, detail),
      onSpeechActive: () => {
        if (deps.vadSettings.get().bargeIn && deps.turnLog.isAudioOwed()) {
          speechPlayback.interrupt({ muteCurrentTurn: true });
        }
      },
    });
  }

  return {
    speechPlayback,
    turnOutput,
    createSttEngine,
    dispose() {
      fillerLoop?.stop();
      speechPlayback.dispose();
    },
  };
}
