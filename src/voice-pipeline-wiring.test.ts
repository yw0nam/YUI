import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const captured: Record<string, unknown> = {};
  const speechPlayback = {
    onSpeechDelta: vi.fn(),
    onSpeechEnd: vi.fn(),
    onSpeech: vi.fn(),
    setCue: vi.fn(),
    holdMotion: vi.fn(),
    isSpeaking: vi.fn(() => false),
    interrupt: vi.fn(),
    abort: vi.fn(),
    dispose: vi.fn(),
  };
  const fillerLoop = {
    start: vi.fn(),
    onUtteranceDone: vi.fn(),
    stop: vi.fn(),
  };
  const sttVad = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
  const openaiSynth = vi.fn().mockResolvedValue(new ArrayBuffer(1));
  const irodoriFactorySynth = vi.fn().mockResolvedValue(new ArrayBuffer(1));
  const irodoriSynth = vi.fn().mockResolvedValue(new ArrayBuffer(1));
  const sink = { play: vi.fn(), stop: vi.fn() };
  const ttsSkip = Symbol("TTS_SKIP");

  return {
    captured,
    speechPlayback,
    fillerLoop,
    sttVad,
    openaiSynth,
    irodoriFactorySynth,
    irodoriSynth,
    sink,
    ttsSkip,
    createSpeechPlayback: vi.fn((options: unknown) => {
      captured.speechPlayback = options;
      return speechPlayback;
    }),
    createFillerLoop: vi.fn((options: unknown) => {
      captured.fillerLoop = options;
      return fillerLoop;
    }),
    createSttVad: vi.fn((options: unknown) => {
      captured.sttVad = options;
      return sttVad;
    }),
    createTtsSynth: vi.fn((options: unknown) => {
      captured.ttsSynth = options;
      return openaiSynth;
    }),
    createIrodoriSynthFactory: vi.fn((options: unknown) => {
      captured.irodoriFactory = options;
      return irodoriFactorySynth;
    }),
    createIrodoriSynth: vi.fn((options: unknown) => {
      captured.irodoriSynth = options;
      return irodoriSynth;
    }),
    createWebAudioSink: vi.fn((options: unknown) => {
      captured.audioSink = options;
      return sink;
    }),
    selectFetch: vi.fn().mockResolvedValue(undefined),
    ensureRegistered: vi.fn().mockResolvedValue(undefined),
    evictRegistration: vi.fn(),
    voiceRevision: vi.fn(() => 0),
  };
});

vi.mock("./io/speech-playback", () => ({
  createSpeechPlayback: mocks.createSpeechPlayback,
}));
vi.mock("./io/filler-loop", () => ({ createFillerLoop: mocks.createFillerLoop }));
vi.mock("./io/stt-vad", () => ({ createSttVad: mocks.createSttVad }));
vi.mock("./io/tts-pipeline", () => ({ TTS_SKIP: mocks.ttsSkip }));
vi.mock("./io/tts-synth", () => ({ createTtsSynth: mocks.createTtsSynth }));
vi.mock("./io/irodori-synth-factory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./io/irodori-synth-factory")>()),
  createIrodoriSynthFactory: mocks.createIrodoriSynthFactory,
}));
vi.mock("./io/irodori-synth", () => ({ createIrodoriSynth: mocks.createIrodoriSynth }));
vi.mock("./io/irodori-voices", () => ({
  ensureRegistered: mocks.ensureRegistered,
  evictRegistration: mocks.evictRegistration,
  voiceRevision: mocks.voiceRevision,
}));
vi.mock("./io/audio-player", () => ({ createWebAudioSink: mocks.createWebAudioSink }));
vi.mock("./io/chat-client", () => ({ selectFetch: mocks.selectFetch }));

import type { FillerConfig } from "./config/load";
import type { EndpointsConfig } from "./contract";
import type { FillerLoopDeps } from "./io/filler-loop";
import type { IrodoriSynthFactoryDeps } from "./io/irodori-synth-factory";
import type { SpeechPlaybackOptions } from "./io/speech-playback";
import type { SttVadOptions } from "./io/stt-vad";
import type { TtsSynthOptions } from "./io/tts-synth";
import { wireVoicePipeline } from "./voice-pipeline-wiring";

function endpoints(overrides: Partial<EndpointsConfig> = {}): EndpointsConfig {
  return {
    chat_base_url: "http://chat.test/v1",
    chat_endpoint: "/responses",
    stt_base_url: "http://stt.test/v1",
    tts_base_url: "http://tts.test",
    tts_provider: "openai",
    ...overrides,
  };
}

function setup() {
  let currentEndpoints = endpoints();
  let fillerConfig: FillerConfig = {
    gap_ms: 1_000,
    gap_jitter_ms: 100,
    pools: { ja: { first: ["first"], repeat: ["repeat"] } },
  };
  const fillerSettings = {
    enabled: true,
    language: "ja" as const,
    customPools: {},
  };
  let ttsEnabled = true;
  let gain = 2;
  let silenceMs = 1_500;
  let bargeIn = false;
  let activeSpeaker = { id: "speaker-a", ref_url: "/speaker-a.wav" };
  const renderer = {
    setMouthOpen: vi.fn(),
    stopMouth: vi.fn(),
    easeEmotionToNeutral: vi.fn(),
    applyDirective: vi.fn(),
    playMotion: vi.fn(),
  };
  const surfaces = {
    beginSpeech: vi.fn(),
    pushSpeech: vi.fn(),
    endSpeech: vi.fn(),
    finishSpeech: vi.fn(),
  };
  const getTtsApiKey = vi.fn().mockResolvedValue("tts-key");
  const getSttApiKey = vi.fn().mockResolvedValue("stt-key");
  const onVoiceSegment = vi.fn();
  const voiceInputStatus = { set: vi.fn() };

  const voice = wireVoicePipeline({
    renderer,
    surfaces,
    getEndpoints: () => currentEndpoints,
    getFillerConfig: () => fillerConfig,
    getTtsApiKey,
    getSttApiKey,
    ttsSettings: { get: () => ({ enabled: ttsEnabled }) },
    lipsyncSettings: { get: () => ({ gain }) },
    fillerSettings: { get: () => fillerSettings },
    vadSettings: { get: () => ({ silenceMs, bargeIn }) },
    speakerSelection: { getActive: () => activeSpeaker },
    voiceInputStatus,
    onVoiceSegment,
  });

  return {
    voice,
    renderer,
    getTtsApiKey,
    getSttApiKey,
    onVoiceSegment,
    voiceInputStatus,
    setEndpoints: (next: EndpointsConfig) => {
      currentEndpoints = next;
    },
    setFillerConfig: (next: FillerConfig) => {
      fillerConfig = next;
    },
    setTtsEnabled: (enabled: boolean) => {
      ttsEnabled = enabled;
    },
    setGain: (next: number) => {
      gain = next;
    },
    setSilenceMs: (next: number) => {
      silenceMs = next;
    },
    setBargeIn: (next: boolean) => {
      bargeIn = next;
    },
    setActiveSpeaker: (next: typeof activeSpeaker) => {
      activeSpeaker = next;
    },
  };
}

function playbackOptions(): SpeechPlaybackOptions {
  return mocks.captured.speechPlayback as SpeechPlaybackOptions;
}

function fillerOptions(): FillerLoopDeps {
  return mocks.captured.fillerLoop as FillerLoopDeps;
}

describe("wireVoicePipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mocks.captured)) delete mocks.captured[key];
    mocks.speechPlayback.isSpeaking.mockReturnValue(false);
    mocks.voiceRevision.mockReturnValue(0);
  });

  it("keeps the latest thinking turn active when an earlier turn ends", () => {
    const { voice, renderer } = setup();
    const first = {};
    const second = {};

    voice.turnOutput.thinkingStart(first);
    voice.turnOutput.thinkingStart(second);
    vi.clearAllMocks();
    voice.turnOutput.thinkingEnd(first);

    expect(mocks.speechPlayback.holdMotion).not.toHaveBeenCalled();
    expect(mocks.fillerLoop.stop).not.toHaveBeenCalled();
    expect(renderer.playMotion).not.toHaveBeenCalled();

    voice.turnOutput.thinkingEnd(second);
    expect(mocks.speechPlayback.holdMotion).toHaveBeenCalledWith(false);
    expect(mocks.fillerLoop.stop).toHaveBeenCalledOnce();
    expect(renderer.playMotion).toHaveBeenCalledWith(null);
  });

  it("holds motion before starting the thinking motion and filler", () => {
    const { voice, renderer } = setup();

    voice.turnOutput.thinkingStart({});

    expect(mocks.speechPlayback.holdMotion).toHaveBeenCalledWith(true);
    expect(renderer.playMotion).toHaveBeenCalledWith({ id: "thinking", loop: true });
    expect(mocks.speechPlayback.holdMotion.mock.invocationCallOrder[0]).toBeLessThan(
      renderer.playMotion.mock.invocationCallOrder[0]!,
    );
    expect(renderer.playMotion.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.fillerLoop.start.mock.invocationCallOrder[0]!,
    );
  });

  it("reports whether either effective filler pool is non-empty", () => {
    const state = setup();
    state.setFillerConfig({ gap_ms: 1, gap_jitter_ms: 0, pools: {} });
    expect(state.voice.turnOutput.hasFiller()).toBe(false);

    state.setFillerConfig({
      gap_ms: 1,
      gap_jitter_ms: 0,
      pools: { ja: { first: ["first"], repeat: [] } },
    });
    expect(state.voice.turnOutput.hasFiller()).toBe(true);

    state.setFillerConfig({
      gap_ms: 1,
      gap_jitter_ms: 0,
      pools: { ja: { first: [], repeat: ["repeat"] } },
    });
    expect(state.voice.turnOutput.hasFiller()).toBe(true);
  });

  it("skips synth when TTS or the selected provider is not configured", async () => {
    const state = setup();
    const synth = playbackOptions().pipeline!.synth!;

    // A filler phrase cached while TTS was on must still skip once TTS is switched off.
    await synth("first");
    state.setTtsEnabled(false);
    await expect(synth("first")).rejects.toBe(mocks.ttsSkip);
    await expect(synth("off")).rejects.toBe(mocks.ttsSkip);

    state.setTtsEnabled(true);
    state.setEndpoints(endpoints({ tts_provider: "irodori", irodori_base_url: undefined }));
    await expect(synth("missing base")).rejects.toBe(mocks.ttsSkip);

    state.setEndpoints(
      endpoints({ tts_provider: "irodori", irodori_base_url: "http://irodori.test" }),
    );
    state.setActiveSpeaker({ id: "", ref_url: "/missing.wav" });
    await expect(synth("missing speaker")).rejects.toBe(mocks.ttsSkip);

    state.setEndpoints(endpoints({ tts_provider: "openai", tts_base_url: "" }));
    await expect(synth("missing openai")).rejects.toBe(mocks.ttsSkip);
  });

  it("routes openai-compatible synth with the live API-key provider", async () => {
    const state = setup();
    await playbackOptions().pipeline!.synth!("hello");

    expect(mocks.createTtsSynth).toHaveBeenCalledOnce();
    const options = mocks.captured.ttsSynth as TtsSynthOptions;
    expect(options.config).toEqual(endpoints());
    expect(options.getApiKey).toBe(state.getTtsApiKey);
    expect(mocks.openaiSynth).toHaveBeenCalledWith("hello", undefined);
  });

  it("routes irodori synth with the active speaker parameters", async () => {
    const state = setup();
    state.setEndpoints(
      endpoints({
        tts_provider: "irodori",
        irodori_base_url: "http://irodori.test",
        irodori_num_steps: 24,
      }),
    );
    state.setActiveSpeaker({ id: "speaker-b", ref_url: "/speaker-b.wav" });

    await playbackOptions().pipeline!.synth!("hello");

    const factory = mocks.captured.irodoriFactory as IrodoriSynthFactoryDeps;
    expect(factory.getParams()).toEqual({
      baseUrl: "http://irodori.test",
      referenceId: "speaker-b",
      refUrl: "/speaker-b.wav",
      numSteps: 24,
      cfgScaleText: undefined,
      cfgScaleSpeaker: undefined,
      seconds: undefined,
    });
    expect(mocks.irodoriFactorySynth).toHaveBeenCalledWith("hello", undefined);
  });

  it("caches filler-pool audio and re-synthesizes it after a TTS settings change", async () => {
    const state = setup();
    const synth = playbackOptions().pipeline!.synth!;

    await synth("first");
    await synth("first");
    await synth("repeat");
    expect(mocks.openaiSynth).toHaveBeenCalledTimes(2);

    await synth("a response sentence");
    await synth("a response sentence");
    expect(mocks.openaiSynth).toHaveBeenCalledTimes(4);

    state.setEndpoints(endpoints({ tts_voice: "another-voice" }));
    await synth("first");
    expect(mocks.openaiSynth).toHaveBeenCalledTimes(5);
  });

  it("invalidates cached filler audio when the irodori speaker or tuning changes", async () => {
    const state = setup();
    const irodori = (numSteps: number) =>
      endpoints({
        tts_provider: "irodori",
        irodori_base_url: "http://irodori.test",
        irodori_num_steps: numSteps,
      });
    state.setEndpoints(irodori(24));
    const synth = playbackOptions().pipeline!.synth!;

    await synth("first");
    await synth("first");
    expect(mocks.irodoriFactorySynth).toHaveBeenCalledTimes(1);

    state.setEndpoints(irodori(32));
    await synth("first");
    expect(mocks.irodoriFactorySynth).toHaveBeenCalledTimes(2);

    state.setActiveSpeaker({ id: "speaker-b", ref_url: "/speaker-b.wav" });
    await synth("first");
    expect(mocks.irodoriFactorySynth).toHaveBeenCalledTimes(3);
  });

  it("re-synthesizes filler after the clip behind the active voice is replaced", async () => {
    const state = setup();
    state.setEndpoints(
      endpoints({ tts_provider: "irodori", irodori_base_url: "http://irodori.test" }),
    );
    const synth = playbackOptions().pipeline!.synth!;

    await synth("first");
    await synth("first");
    expect(mocks.irodoriFactorySynth).toHaveBeenCalledTimes(1);

    // Importing a clip over an existing name replaces the voice while its id stays the same.
    mocks.voiceRevision.mockReturnValue(1);
    await synth("first");
    expect(mocks.irodoriFactorySynth).toHaveBeenCalledTimes(2);
  });

  it("drops cached filler audio when the filler pool is edited", async () => {
    const state = setup();
    const synth = playbackOptions().pipeline!.synth!;

    await synth("first");
    state.setFillerConfig({
      gap_ms: 1_000,
      gap_jitter_ms: 100,
      pools: { ja: { first: ["first"], repeat: ["another"] } },
    });
    await synth("first");

    expect(mocks.openaiSynth).toHaveBeenCalledTimes(2);
  });

  it("reads pipeline, sink, filler, and VAD settings at call time", async () => {
    const state = setup();
    const pipeline = playbackOptions().pipeline!;
    const sinkOptions = mocks.captured.audioSink as NonNullable<
      Parameters<typeof import("./io/audio-player").createWebAudioSink>[0]
    >;

    expect(typeof pipeline.maxInflight).toBe("function");
    expect((pipeline.maxInflight as () => number)()).toBe(1);
    state.setEndpoints(endpoints({ tts_max_inflight: 4 }));
    expect((pipeline.maxInflight as () => number)()).toBe(4);

    expect(sinkOptions.getGain!()).toBe(2);
    state.setGain(5);
    expect(sinkOptions.getGain!()).toBe(5);

    expect(fillerOptions().getTiming()).toEqual({ gapMs: 1_000, jitterMs: 100 });
    state.setFillerConfig({ gap_ms: 2_000, gap_jitter_ms: 250, pools: {} });
    expect(fillerOptions().getTiming()).toEqual({ gapMs: 2_000, jitterMs: 250 });

    await state.voice.createSttEngine(endpoints());
    const sttOptions = mocks.captured.sttVad as SttVadOptions;
    expect((sttOptions.silenceMs as () => number)()).toBe(1_500);
    state.setSilenceMs(900);
    expect((sttOptions.silenceMs as () => number)()).toBe(900);
  });

  it("notifies the filler loop when speech playback ends", () => {
    setup();
    playbackOptions().onPlaybackEnd!();
    expect(mocks.fillerLoop.onUtteranceDone).toHaveBeenCalledOnce();
  });

  it("wires STT callbacks, state, credentials, and the endpoints snapshot", async () => {
    const state = setup();
    const snapshot = endpoints({ stt_base_url: "http://snapshot.test/v1" });
    const result = await state.voice.createSttEngine(snapshot);
    const options = mocks.captured.sttVad as SttVadOptions;

    expect(result).toBe(mocks.sttVad);
    expect(options.config).toBe(snapshot);
    expect(options.getApiKey).toBe(state.getSttApiKey);
    options.onVoiceSegment("transcript");
    options.onState!("error", "detail");
    expect(state.onVoiceSegment).toHaveBeenCalledWith("transcript");
    expect(state.voiceInputStatus.set).toHaveBeenCalledWith("error", "detail");
  });

  it("interrupts active playback only when barge-in is enabled", async () => {
    const state = setup();
    await state.voice.createSttEngine(endpoints());
    const onSpeechActive = (mocks.captured.sttVad as SttVadOptions).onSpeechActive!;

    onSpeechActive();
    expect(mocks.speechPlayback.interrupt).not.toHaveBeenCalled();

    state.setBargeIn(true);
    onSpeechActive();
    expect(mocks.speechPlayback.interrupt).not.toHaveBeenCalled();

    mocks.speechPlayback.isSpeaking.mockReturnValue(true);
    onSpeechActive();
    expect(mocks.speechPlayback.interrupt).toHaveBeenCalledWith({ muteCurrentTurn: true });
  });

  it("stops filler playback and disposes speech playback", () => {
    const { voice } = setup();
    voice.dispose();
    expect(mocks.fillerLoop.stop).toHaveBeenCalledOnce();
    expect(mocks.speechPlayback.dispose).toHaveBeenCalledOnce();
  });
});
