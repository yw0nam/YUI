import type { AppConfig } from "./config/load";
import type { EndpointsConfig } from "./contract";
import type { TurnLog } from "./dispatcher/turn";
import type { TurnOutput } from "./dispatcher/turn-output";
import { createWebAudioSink } from "./io/audio-player";
import { selectFetch } from "./io/chat-client";
import { createFillerAudioCache } from "./io/filler-audio-cache";
import { createFillerLoop, type FillerLoop } from "./io/filler-loop";
import { effectiveFillerPool, fillerSubmissions, phraseSentences } from "./io/filler-pool";
import type { FillerSettings } from "./io/filler-settings";
import type { SpeakerOption } from "./io/speaker-selection";
import { createSpeechPlayback, type SpeechPlayback } from "./io/speech-playback";
import type { SttVad } from "./io/stt-vad";
import { TTS_SKIP } from "./io/tts-pipeline";
import { createTtsProvider } from "./io/tts-synth";
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
  createSttEngine: () => Promise<SttVad>;
  dispose: () => void;
}

/**
 * Voice-pipeline core: TTS synth with a session-scoped filler audio cache, speech playback,
 * TTFT filler loop, thinking-turn handlers, and the STT/VAD engine factory incl. barge-in.
 * All config/settings reads are lazy (call-time) so hot-reload and slider edits take effect
 * without rewiring. The caller registers HMR teardown via the returned dispose().
 */
export function wireVoicePipeline(deps: VoicePipelineDeps): VoicePipeline {
  const provider = createTtsProvider({
    getEndpoints: deps.getEndpoints,
    getActiveSpeaker: () => deps.speakerSelection.getActive(),
    getApiKey: deps.getTtsApiKey,
    selectFetch,
  });

  const effectiveFiller = () =>
    effectiveFillerPool(deps.fillerSettings.get(), deps.getFillerConfig());

  const fillerCache = createFillerAudioCache({
    synth: (input, signal) => provider.synth(input, signal),
    // Filler is spoken under motion-hold, which withholds cues from the pipeline, so a filler
    // submission never carries a voice tag and matching the plain sentences is enough.
    submissions: () => fillerSubmissions(effectiveFiller()),
    // Only what changes the rendered audio — a change here stales every entry. Editing the pool
    // leaves the key alone and evicts per phrase instead.
    // The active speaker's persisted revision is folded in on top of the provider's paramsKey()
    // so a re-upload of the clip behind an unchanged speaker id — including one committed in the
    // settings window — invalidates this window's cache too.
    paramsKey: () => {
      const revision = deps.speakerSelection.getActive().revision ?? 0;
      return [provider.paramsKey(), revision].join("\n");
    },
  });

  // Skip guards stay outside the cache so a cached phrase can never outlive the reason to stay silent.
  const synth = async (input: string, signal?: AbortSignal): Promise<ArrayBuffer> => {
    // TTS inactive (toggle OFF or server unset) quietly skips — expressions/motions, bubble unchanged.
    if (!deps.ttsSettings.get().enabled) return Promise.reject(TTS_SKIP);
    if (!provider.isReady()) return Promise.reject(TTS_SKIP);
    return fillerCache.synth(input, signal);
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
      // A dead TTS server would otherwise be retried once per gap for the whole thinking window.
      // Response-speech failures share the signal; the next thinking start clears it either way.
      onSynthFailure: () => fillerLoop?.onSynthFailure(),
    },
  });

  fillerLoop = createFillerLoop({
    speak: (text) => speechPlayback.onSpeech(text),
    getPools: effectiveFiller,
    getTiming: () => ({
      gapMs: deps.getFillerConfig().gap_ms,
      jitterMs: deps.getFillerConfig().gap_jitter_ms,
    }),
    // All-or-nothing: one uncached sentence would put the whole phrase back on the dead server.
    // A phrase that submits nothing (emoji only) is not speakable either.
    isCached: (phrase) => {
      const sentences = phraseSentences(phrase);
      return sentences.length > 0 && sentences.every((sentence) => fillerCache.has(sentence));
    },
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
          // The disposed utterance can no longer report completion, and the user is talking —
          // this window's filler is over, not merely waiting.
          fillerLoop?.stop();
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
