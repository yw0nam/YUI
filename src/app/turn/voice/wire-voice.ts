import type { AppConfig } from "../../../config/load";
import { STT_API_KEY_SECRET, TTS_API_KEY_SECRET } from "../../../config/secrets";
import type { EndpointsConfig } from "../../../contract";
import {
  createPreviousTurn,
  type PreviousTurnSlot,
} from "../../../dispatcher/backend/previous-turn";
import { createPushTurns, type PushTurns } from "../../../dispatcher/turn/push-turn";
import { createQuotedTurn, type QuotedTurn } from "../../../dispatcher/turn/quoted-turn";
import { createTurnLog, type TurnLog } from "../../../dispatcher/turn/turn";
import type { SttVad } from "../../../io/voice/stt-vad";
import type { SpeakerOption } from "../../../io/voice/voices/speaker-selection";
import type { Renderer } from "../../../renderer";
import type { SettingsStores } from "../../../settings/settings-stores";
import { createVoiceErrorDwell } from "../../../ui/chips/voice-error-dwell";
import type { VoiceInputStatus } from "../../../ui/chips/voice-input-status";
import type { Surfaces } from "../../../ui/surfaces/surfaces";
import { type VoicePipeline, wireVoicePipeline } from "./wire-voice-pipeline";

/** Whether voice input was left on, kept across runs; a window that resumes nothing passes none. */
export interface VoicePersistence {
  get(): boolean;
  set(on: boolean): void;
}

/** A window that owns capture intent: the dwell reverts to its wish, and it hears when capture runs. */
export interface VoiceHost {
  wanted(): boolean;
  onCaptureStarted(): void;
  /** The engine could not start capture, whatever the cause. */
  onCaptureFailed(): void;
}

export function wireTurnVoice(deps: {
  renderer: Renderer;
  surfaces: Pick<
    Surfaces,
    | "beginSpeech"
    | "pushSpeech"
    | "endSpeech"
    | "finishSpeech"
    | "quoteUser"
    | "settleQuote"
    | "clearQuote"
    | "restoreInput"
  >;
  voiceInputStatus: VoiceInputStatus;
  voicePersistence?: VoicePersistence;
  voiceHost?: VoiceHost;
  ttsSettings: { get(): { enabled: boolean } };
  lipsyncSettings: { get(): { gain: number } };
  fillerSettings: SettingsStores["fillerSettings"];
  vadSettings: { get(): { silenceMs: number; bargeIn: boolean } };
  speakerSelection: { getActive(): SpeakerOption };
  getEndpoints: () => EndpointsConfig;
  getConfig: () => AppConfig;
  getSecret: (name: string) => Promise<string | undefined>;
  submitVoice: (text: string) => void;
  register: (teardown: () => void) => void;
}): {
  voice: VoicePipeline;
  voiceInput: ReturnType<typeof wireVoiceInput>;
  voiceErrorDwell: ReturnType<typeof createVoiceErrorDwell>;
  turnLog: TurnLog;
  previousTurn: PreviousTurnSlot;
  quotedTurn: QuotedTurn;
  pushTurns: PushTurns;
  setProactiveSource(source: { noteInteraction(ts?: number): void }): void;
  setStrolling(walker: { isStrolling(): boolean }): void;
} {
  const {
    renderer,
    surfaces,
    voiceInputStatus,
    voicePersistence,
    voiceHost,
    ttsSettings,
    lipsyncSettings,
    fillerSettings,
    vadSettings,
    speakerSelection,
    getEndpoints,
    getConfig,
    getSecret,
    submitVoice,
    register,
  } = deps;

  const voiceErrorDwell = createVoiceErrorDwell(voiceInputStatus, voiceHost);
  register(() => voiceErrorDwell.dispose());

  // Voice creation precedes sources, so interaction notes stay late-bound across that cycle.
  let proactiveSourceRef: { noteInteraction(ts?: number): void } | null = null;

  const voiceInput = wireVoiceInput({ voiceInputStatus, voicePersistence, voiceHost });
  register(voiceInput.dispose);
  const turnLog = createTurnLog();
  const previousTurn = createPreviousTurn({ currentTurn: () => turnLog.current() });
  const quotedTurn = createQuotedTurn({ surfaces, turnLog });
  register(quotedTurn.dispose);
  // Voice creation precedes the walker, so the stroll query stays late-bound across that cycle.
  let strollingRef: { isStrolling(): boolean } | null = null;
  const pushTurns = createPushTurns();
  const voice = wireVoicePipeline({
    renderer,
    surfaces,
    turnLog,
    isStrolling: () => strollingRef?.isStrolling() ?? false,
    getEndpoints,
    getFillerConfig: () => getConfig().filler,
    getTtsApiKey: () => getSecret(TTS_API_KEY_SECRET),
    getSttApiKey: () => getSecret(STT_API_KEY_SECRET),
    ttsSettings,
    lipsyncSettings,
    fillerSettings,
    vadSettings,
    speakerSelection,
    voiceInputStatus,
    onVoiceSegment: (text) => {
      submitVoice(text);
      proactiveSourceRef?.noteInteraction();
    },
    onUtteranceStart: () => {
      previousTurn.utteranceStart();
      quotedTurn.utteranceStart();
    },
    onUtteranceEnd: previousTurn.utteranceEnd,
    onBargeIn: () => pushTurns.cut(),
  });
  register(voice.dispose);

  return {
    voice,
    voiceInput,
    voiceErrorDwell,
    turnLog,
    previousTurn,
    quotedTurn,
    pushTurns,
    setProactiveSource(source) {
      proactiveSourceRef = source;
    },
    setStrolling(walker) {
      strollingRef = walker;
    },
  };
}

/**
 * STT/VAD voice-input lifecycle: start/stop driven by the voiceInputStatus store, on/off intent
 * persisted through the persistence port for next-run auto-resume, and the STT engine bound
 * post-config via setStt (which also auto-resumes if voice was left on last session). The engine's
 * submit/barge-in callbacks are wired at the createSttVad call site, not here — this seam only owns
 * the lifecycle.
 */
export function wireVoiceInput(deps: {
  voiceInputStatus: VoiceInputStatus;
  voicePersistence?: VoicePersistence;
  voiceHost?: VoiceHost;
}): {
  setStt: (stt: SttVad) => void;
  dispose: () => void;
} {
  const { voiceInputStatus, voicePersistence, voiceHost } = deps;
  let sttVad: SttVad | null = null;
  let ready = false;
  let startRequested = false;

  async function startVoiceInput(): Promise<void> {
    startRequested = true;
    if (!ready || !sttVad) return;
    try {
      await sttVad.start();
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Voice input failed";
      voiceInputStatus.set("error", detail);
      voiceHost?.onCaptureFailed();
      return;
    }
    // A stop() that landed while the capture started cancels it, and there is nothing to report.
    if (startRequested) voiceHost?.onCaptureStarted();
  }
  function stopVoiceInput(): void {
    startRequested = false;
    sttVad?.stop();
  }
  const unsubscribeStatus = voiceInputStatus.subscribe((snapshot) => {
    if (snapshot.state === "idle") {
      stopVoiceInput();
      return;
    }
    if (snapshot.state === "listening") {
      void startVoiceInput();
    }
  });
  // Persist voice input on/off intent — on if not idle. Used for auto-resume on next run.
  const unsubscribePersist = voiceInputStatus.subscribe((snapshot) => {
    voicePersistence?.set(snapshot.state !== "idle");
  });
  // Bind the STT engine once config is loaded; mark ready then auto-resume if left on last session.
  const setStt = (stt: SttVad): void => {
    sttVad = stt;
    ready = true;
    if (startRequested || voiceInputStatus.get().state !== "idle" || voicePersistence?.get()) {
      void startVoiceInput();
    }
  };
  const dispose = (): void => {
    unsubscribeStatus();
    unsubscribePersist();
    void sttVad?.dispose();
  };
  return { setStt, dispose };
}
