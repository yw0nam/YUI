import type { AppConfig, FillerPool } from "./config/load";
import type { EndpointsConfig } from "./contract";
import type { TurnLog } from "./dispatcher/turn";
import type { TurnOutput } from "./dispatcher/turn-output";
import { createWebAudioSink } from "./io/audio-player";
import { selectFetch } from "./io/chat-client";
import { createFillerAudioCache } from "./io/filler-audio-cache";
import { createFillerLoop, type FillerLoop } from "./io/filler-loop";
import { effectiveFillerPool } from "./io/filler-pool";
import type { FillerSettings } from "./io/filler-settings";
import { createIrodoriTtsProvider } from "./io/irodori-synth";
import { createSentenceSegmenter } from "./io/sentence-segmenter";
import type { SpeakerOption } from "./io/speaker-selection";
import { createSpeechPlayback, type SpeechPlayback } from "./io/speech-playback";
import { createEmojiStripper } from "./io/strip-emoji";
import type { SttVad } from "./io/stt-vad";
import { TTS_SKIP } from "./io/tts-pipeline";
import { selectProvider, type TtsProvider } from "./io/tts-provider";
import { createOpenAiTtsProvider } from "./io/tts-synth";
import type { Renderer } from "./renderer";
import type { Surfaces } from "./ui/surfaces";
import type { VoiceInputStatus } from "./ui/voice-input-status";

/**
 * The sentences a pool phrase actually reaches TTS as: the speech path strips emoji and splits on
 * sentence boundaries before submitting, so a phrase carrying either never arrives as written.
 * Runs the production stripper and segmenter so the two stay in step.
 */
function fillerSubmissions(pool: FillerPool): Set<string> {
  const submissions = new Set<string>();
  for (const phrase of [...pool.first, ...pool.repeat]) {
    const stripper = createEmojiStripper();
    const segmenter = createSentenceSegmenter();
    for (const sentence of segmenter.push(stripper.push(phrase) + stripper.flush())) {
      submissions.add(sentence);
    }
    const rest = segmenter.flush();
    if (rest) submissions.add(rest);
  }
  return submissions;
}

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
  createSttEngine: () => Promise<SttVad>;
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
  const providers = {
    irodori: createIrodoriTtsProvider({
      getEndpoints: deps.getEndpoints,
      getActiveSpeaker: () => deps.speakerSelection.getActive(),
      selectFetch,
    }),
    openai: createOpenAiTtsProvider({
      getEndpoints: deps.getEndpoints,
      getApiKey: deps.getTtsApiKey,
      selectFetch,
    }),
  };
  const activeProvider = (): TtsProvider => selectProvider(deps.getEndpoints(), providers);

  const effectiveFiller = () =>
    effectiveFillerPool(deps.fillerSettings.get(), deps.getFillerConfig());

  const cachedSynth = createFillerAudioCache({
    synth: (input, signal) => activeProvider().synth(input, signal),
    // Filler is spoken under motion-hold, which withholds cues from the pipeline, so a filler
    // submission never carries a voice tag and matching the plain sentences is enough.
    isFiller: (text) => fillerSubmissions(effectiveFiller()).has(text),
    // Everything that changes the rendered audio or the set of cacheable phrases. Audio held under
    // an older key is dropped, which is also what keeps the map to the current pool.
    // The active speaker's revision is folded in on top of the provider's own paramsKey() so a
    // re-import committed in another window (settings) invalidates this window's (pet) cache too —
    // the provider's in-process revision only covers a re-import from the same window.
    paramsKey: () => {
      const pool = effectiveFiller();
      const revision = deps.speakerSelection.getActive().revision ?? 0;
      return [activeProvider().paramsKey(), revision, ...pool.first, ...pool.repeat].join("\n");
    },
  });

  // Skip guards stay outside the cache so a cached phrase can never outlive the reason to stay silent.
  const synth = async (input: string, signal?: AbortSignal): Promise<ArrayBuffer> => {
    // TTS inactive (toggle OFF or server unset) quietly skips — expressions/motions, bubble unchanged.
    if (!deps.ttsSettings.get().enabled) return Promise.reject(TTS_SKIP);
    if (!activeProvider().isReady()) return Promise.reject(TTS_SKIP);
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

  async function createSttEngine(): Promise<SttVad> {
    const { createSttVad } = await import("./io/stt-vad");
    return createSttVad({
      config: deps.getEndpoints,
      fetch: await selectFetch(),
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
