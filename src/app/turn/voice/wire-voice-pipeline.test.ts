import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const captured: Record<string, unknown> = {};
  // Stands in for the pipeline's own owed-audio state, which is what the barge-in guard reads.
  const speech = { outstanding: false };
  const speechPlayback = {
    onSpeechDelta: vi.fn(() => {
      speech.outstanding = true;
    }),
    onSpeechEnd: vi.fn(),
    onSpeech: vi.fn(() => {
      speech.outstanding = true;
    }),
    speakAside: vi.fn(),
    setCue: vi.fn(),
    silentCue: vi.fn(),
    holdMotion: vi.fn(() => false),
    interrupt: vi.fn(() => {
      speech.outstanding = false;
    }),
    hasOutstandingSpeech: vi.fn(() => speech.outstanding),
    abort: vi.fn(),
    dispose: vi.fn(),
  };
  const fillerLoop = {
    start: vi.fn(),
    onUtteranceDone: vi.fn(),
    onToolRunning: vi.fn(),
    onActivity: vi.fn(),
    onSynthFailure: vi.fn(),
    stop: vi.fn(),
  };
  const sttVad = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(),
    dispose: vi.fn(async () => undefined),
  };
  const sink = { play: vi.fn(), stop: vi.fn() };
  const ttsSkip = Symbol("TTS_SKIP");
  const fetchImpl = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
    async () =>
      ({
        ok: true,
        status: 200,
        headers: new Headers(),
        arrayBuffer: async () => new ArrayBuffer(4),
        json: async () => ({}),
      }) as unknown as Response,
  );

  return {
    captured,
    speech,
    speechPlayback,
    fillerLoop,
    sttVad,
    sink,
    ttsSkip,
    fetchImpl,
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
    createWebAudioSink: vi.fn((options: unknown) => {
      captured.audioSink = options;
      return sink;
    }),
    selectFetch: vi.fn(async () => fetchImpl),
    // Voice-import-flow fakes, used only by the cross-window re-import test below — drives the
    // settings-window side with the real commitVoiceImport instead of hand-writing its effects.
    upsertVoice: vi.fn(async () => undefined),
    pickVoiceFile: vi.fn<typeof import("../../../io/voice/voices/voice-import").pickVoiceFile>(),
    renameUserVoice: vi.fn(),
  };
});

vi.mock("../../../io/voice/tts/speech-playback", () => ({
  createSpeechPlayback: mocks.createSpeechPlayback,
}));
vi.mock("../../../io/voice/filler/filler-loop", () => ({
  createFillerLoop: mocks.createFillerLoop,
}));
vi.mock("../../../io/voice/stt-vad", () => ({ createSttVad: mocks.createSttVad }));
vi.mock("../../../io/voice/tts/tts-pipeline", () => ({ TTS_SKIP: mocks.ttsSkip }));
vi.mock("../../../io/voice/voices/tts-voices", () => ({
  upsertVoice: mocks.upsertVoice,
  listVoices: vi.fn(),
  deleteVoice: vi.fn(),
}));
vi.mock("../../../io/voice/tts/audio-player", () => ({
  createWebAudioSink: mocks.createWebAudioSink,
}));
vi.mock("../../../io/chat/stream/chat-client", () => ({ selectFetch: mocks.selectFetch }));
vi.mock("../../../io/voice/voices/voice-import", () => ({
  pickVoiceFile: mocks.pickVoiceFile,
  removeUserVoice: vi.fn(async () => undefined),
  renameUserVoice: mocks.renameUserVoice,
}));

import type { FillerConfig, FillerPool } from "../../../config/validators/filler";
import type { EndpointsConfig } from "../../../contract";
import { createTurnLog } from "../../../dispatcher/turn/turn";
import type { FillerLoopDeps } from "../../../io/voice/filler/filler-loop";
import type { SttVadOptions } from "../../../io/voice/stt-vad";
import type { SpeechPlaybackOptions } from "../../../io/voice/tts/speech-playback";
import {
  createSpeakerSelection,
  localStorageSpeakerStorage,
  localStorageUserSpeakerStorage,
  type SpeakerOption,
} from "../../../io/voice/voices/speaker-selection";
import { createVoiceImportFlow } from "../../../io/voice/voices/voice-import-flow";
import { wireVoicePipeline } from "./wire-voice-pipeline";

const noopLog = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

// In-memory Storage stand-in shared by two speakerSelection instances, so they behave like the
// same localStorage two real windows would share (jsdom/window are not available in this file's
// node test environment).
function fillerPool(overrides: Partial<FillerPool> = {}): FillerPool {
  return {
    first: [],
    repeat: [],
    long_wait: [],
    tool: {},
    timeout: [],
    unreachable: [],
    ...overrides,
  };
}

function sharedLocalStorage(): Storage {
  const backing = new Map<string, string>();
  return {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => void backing.set(key, value),
    removeItem: (key: string) => void backing.delete(key),
    clear: () => backing.clear(),
    key: () => null,
    get length() {
      return backing.size;
    },
  } as Storage;
}

function endpoints(overrides: Partial<EndpointsConfig> = {}): EndpointsConfig {
  return {
    chat_base_url: "http://chat.test/v1",
    stt_base_url: "http://stt.test/v1",
    tts_base_url: "http://tts.test",
    tts_model: "irodori-tts",
    ...overrides,
  };
}

// Fetch calls the synth path makes: POST {tts_base_url}/v1/audio/speech.
function synthCalls(): unknown[][] {
  return mocks.fetchImpl.mock.calls.filter(([url]) => String(url).endsWith("/v1/audio/speech"));
}

function setup(over: { isStrolling?: () => boolean } = {}) {
  let currentEndpoints = endpoints();
  let fillerConfig: FillerConfig = {
    gap_ms: 1_000,
    gap_jitter_ms: 100,
    max_repeats: 3,
    gap_growth: 2,
    long_wait_ms: 40000,
    pools: { ja: fillerPool({ first: ["first"], repeat: ["repeat"] }) },
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
  let activeSpeaker: SpeakerOption = { id: "speaker-a", ref_url: "/speaker-a.wav" };
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
  const onUtteranceStart = vi.fn();
  const onUtteranceEnd = vi.fn();
  const onBargeIn = vi.fn();
  const onSpeechActive = vi.fn();
  const voiceInputStatus = { set: vi.fn() };
  const turnLog = createTurnLog();

  const voice = wireVoicePipeline({
    renderer,
    surfaces,
    turnLog,
    getEndpoints: () => currentEndpoints,
    getFillerConfig: () => fillerConfig,
    getTtsApiKey,
    getSttApiKey,
    ttsSettings: { get: () => ({ enabled: ttsEnabled }) },
    oneVoiceSettings: { get: () => ({ enabled: false }) },
    lipsyncSettings: { get: () => ({ gain }) },
    fillerSettings: { get: () => fillerSettings },
    readingsSettings: { get: () => ({ text: "" }) },
    vadSettings: { get: () => ({ silenceMs, bargeIn }) },
    speakerSelection: { getActive: () => activeSpeaker },
    refreshVoiceList: async () => ({ kind: "skipped" }),
    checkTtsServer: async () => null,
    voiceInputStatus,
    onVoiceSegment,
    onUtteranceStart,
    onUtteranceEnd,
    onBargeIn,
    onSpeechActive,
    isStrolling: over.isStrolling ?? (() => false),
  });

  return {
    voice,
    renderer,
    turnLog,
    getTtsApiKey,
    getSttApiKey,
    onVoiceSegment,
    onUtteranceStart,
    onUtteranceEnd,
    onBargeIn,
    onSpeechActive,
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
    setActiveSpeaker: (next: SpeakerOption) => {
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
    mocks.speech.outstanding = false;
    for (const key of Object.keys(mocks.captured)) delete mocks.captured[key];
    mocks.selectFetch.mockResolvedValue(mocks.fetchImpl);
    mocks.fetchImpl.mockImplementation(
      async () =>
        ({
          ok: true,
          status: 200,
          headers: new Headers(),
          arrayBuffer: async () => new ArrayBuffer(4),
          json: async () => ({}),
        }) as unknown as Response,
    );
  });

  it("skips synth when TTS is off, the server is unset, or no speaker is selected", async () => {
    const state = setup();
    const synth = playbackOptions().pipeline!.synth!;

    // A filler phrase cached while TTS was on must still skip once TTS is switched off.
    await synth("first");
    const callsBeforeSkips = mocks.fetchImpl.mock.calls.length;
    state.setTtsEnabled(false);
    await expect(synth("first")).rejects.toBe(mocks.ttsSkip);
    await expect(synth("off")).rejects.toBe(mocks.ttsSkip);

    state.setTtsEnabled(true);
    state.setEndpoints(endpoints({ tts_base_url: "" }));
    await expect(synth("missing base")).rejects.toBe(mocks.ttsSkip);

    state.setEndpoints(endpoints());
    state.setActiveSpeaker({ id: "", ref_url: "/missing.wav" });
    await expect(synth("missing speaker")).rejects.toBe(mocks.ttsSkip);

    // None of the skip paths should have reached the network.
    expect(mocks.fetchImpl.mock.calls.length).toBe(callsBeforeSkips);
  });

  it("routes synth to the TTS server with the model, the active speaker as voice, and the live key", async () => {
    const state = setup();
    state.setActiveSpeaker({ id: "ナツメ", ref_url: "/natsume.wav" });

    await playbackOptions().pipeline!.synth!("hello");

    expect(synthCalls()).toHaveLength(1);
    const [url, init] = mocks.fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://tts.test/v1/audio/speech");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      input: "hello",
      model: "irodori-tts",
      voice: "ナツメ",
      response_format: "wav",
    });
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tts-key");
    expect(state.getTtsApiKey).toHaveBeenCalled();
  });

  // The wrappers between the playback synth and createTtsSynth each take (input, signal), and TS
  // accepts a narrower function where a wider one is expected — so a dropped third argument
  // typechecks and only shows up as a missing body key.
  it("carries a per-call caption through the wrappers into the request body", async () => {
    setup();

    await playbackOptions().pipeline!.synth!("hello", undefined, {
      caption: "囁くような小さな声で。",
    });

    expect(synthCalls()).toHaveLength(1);
    const [, init] = synthCalls()[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.irodori).toEqual({ caption: "囁くような小さな声で。" });
    expect(body.input).toBe("hello");
  });

  it("sends no irodori key when a response sentence carries no caption", async () => {
    setup();

    await playbackOptions().pipeline!.synth!("hello");

    const [, init] = synthCalls()[0] as [string, RequestInit];
    expect("irodori" in JSON.parse(init.body as string)).toBe(false);
  });

  // Filler audio is cached under input+paramsKey, and that key carries no caption — a
  // caption-conditioned render stored there would be replayed for every later plain filler.
  it("never sends a caption on the cached filler path", async () => {
    setup();
    const synth = playbackOptions().pipeline!.synth!;

    await synth("first", undefined, { caption: "囁くような小さな声で。" });

    const [, init] = synthCalls()[0] as [string, RequestInit];
    expect("irodori" in JSON.parse(init.body as string)).toBe(false);
  });

  it("caches filler-pool audio and re-synthesizes it after a TTS model change", async () => {
    const state = setup();
    const synth = playbackOptions().pipeline!.synth!;

    await synth("first");
    await synth("first");
    await synth("repeat");
    expect(synthCalls()).toHaveLength(2);

    await synth("a response sentence");
    await synth("a response sentence");
    expect(synthCalls()).toHaveLength(4);

    state.setEndpoints(endpoints({ tts_model: "another-model" }));
    await synth("first");
    expect(synthCalls()).toHaveLength(5);
  });

  it("invalidates cached filler audio when the active speaker changes", async () => {
    const state = setup();
    const synth = playbackOptions().pipeline!.synth!;

    await synth("first");
    await synth("first");
    expect(synthCalls()).toHaveLength(1);

    state.setActiveSpeaker({ id: "speaker-b", ref_url: "/speaker-b.wav" });
    await synth("first");
    expect(synthCalls()).toHaveLength(2);
  });

  it("re-synthesizes filler after the clip behind the active voice is replaced", async () => {
    const state = setup();
    const synth = playbackOptions().pipeline!.synth!;

    await synth("first");
    await synth("first");
    expect(synthCalls()).toHaveLength(1);

    // Re-uploading a clip over an existing name replaces the voice while its id stays the same —
    // the persisted revision is the only signal that earlier audio for that id is now stale.
    state.setActiveSpeaker({ id: "speaker-a", ref_url: "/speaker-a.wav", revision: 1 });
    await synth("first");
    expect(synthCalls()).toHaveLength(2);
  });

  it("re-synthesizes filler after commitVoiceImport re-imports the already-active voice in another window", async () => {
    // Two independent speakerSelection instances sharing one localStorage — stand-ins for the
    // settings window (A, performs the re-import) and the pet window (B, owns the filler cache).
    const storage = sharedLocalStorage();
    const storageOpts = () => ({
      storage: localStorageSpeakerStorage(),
      userStorage: localStorageUserSpeakerStorage(),
    });
    vi.stubGlobal("localStorage", storage);
    try {
      // Seed the prior import directly — the event under test is the re-import below, not this setup.
      const windowA = createSpeakerSelection({ defaultValue: "", ...storageOpts() });
      windowA.addUserOption({
        id: "myvoice",
        label: "My Voice",
        ref_url: "/myvoice-v1.wav",
        source: "user",
      });
      windowA.select("myvoice");
      // The clip is staged under a temporary id, then moved over the stored voice's folder.
      mocks.pickVoiceFile.mockResolvedValue({
        staged: {
          id: "import-staged",
          label: "import-staged",
          ref_url: "/import-staged.wav",
          source: "user",
        },
        seedName: "MyVoice",
      });
      mocks.renameUserVoice.mockResolvedValue("/myvoice-v2.wav");
      const { pickVoiceImport: pickOnWindowA, commitVoiceImport: commitOnWindowA } =
        createVoiceImportFlow({
          getEndpoints: () => ({ tts_base_url: "http://tts.test" }),
          speakerSelection: windowA,
          log: noopLog,
        });

      // Window B loads the already-persisted option at construction time, same as opening the
      // pet window after a voice was imported in a prior session.
      const windowB = createSpeakerSelection({ defaultValue: "", ...storageOpts() });
      // Production wires speakerSelection.subscribe(broadcastSettings), which (via the bridge and
      // the other window's onSettingsChanged, see wire-window-sync.ts) ends in the other window's
      // reloadFromStorage() — that glue is covered by settings-window.test.ts/wire-window-sync.test.ts.
      // Standing in for it directly here keeps this test scoped to what actually broke: window B
      // is only ever woken through window A's own subscriber, never by an unconditional reload.
      let windowAChanged = false;
      windowA.subscribe(() => {
        windowAChanged = true;
        windowB.reloadFromStorage();
      });

      const currentEndpoints = endpoints();
      wireVoicePipeline({
        renderer: {
          setMouthOpen: vi.fn(),
          stopMouth: vi.fn(),
          easeEmotionToNeutral: vi.fn(),
          applyDirective: vi.fn(),
          playMotion: vi.fn(),
        },
        surfaces: {
          beginSpeech: vi.fn(),
          pushSpeech: vi.fn(),
          endSpeech: vi.fn(),
          finishSpeech: vi.fn(),
        },
        turnLog: createTurnLog(),
        getEndpoints: () => currentEndpoints,
        getFillerConfig: () => ({
          gap_ms: 1_000,
          gap_jitter_ms: 100,
          max_repeats: 3,
          gap_growth: 2,
          long_wait_ms: 40000,
          pools: { ja: fillerPool({ first: ["first"], repeat: ["repeat"] }) },
        }),
        getTtsApiKey: vi.fn().mockResolvedValue(undefined),
        getSttApiKey: vi.fn().mockResolvedValue(undefined),
        ttsSettings: { get: () => ({ enabled: true }) },
        oneVoiceSettings: { get: () => ({ enabled: false }) },
        lipsyncSettings: { get: () => ({ gain: 1 }) },
        fillerSettings: { get: () => ({ enabled: true, language: "ja", customPools: {} }) },
        readingsSettings: { get: () => ({ text: "" }) },
        vadSettings: { get: () => ({ silenceMs: 1_500, bargeIn: false }) },
        speakerSelection: windowB,
        refreshVoiceList: async () => ({ kind: "skipped" }),
        checkTtsServer: async () => null,
        voiceInputStatus: { set: vi.fn() },
        onVoiceSegment: vi.fn(),
        onUtteranceStart: vi.fn(),
        onUtteranceEnd: vi.fn(),
        isStrolling: () => false,
      });
      const synth = playbackOptions().pipeline!.synth!;

      await synth("first");
      await synth("first");
      expect(synthCalls()).toHaveLength(1);

      // Window A re-imports "myvoice" under the same name it is already active under — same id,
      // new clip, no selection change. This is the #506 scenario: re-importing the active voice.
      const staged = (await pickOnWindowA())!.stagedId;
      await commitOnWindowA(staged, "myvoice");

      // The store must have notified its own subscribers — without that, nothing wakes window B.
      expect(windowAChanged).toBe(true);

      await synth("first");
      expect(synthCalls()).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("drops cached filler audio only for the phrase an edit removed from the pool", async () => {
    const state = setup();
    const synth = playbackOptions().pipeline!.synth!;

    await synth("first");
    await synth("repeat");
    expect(synthCalls()).toHaveLength(2);

    state.setFillerConfig({
      gap_ms: 1_000,
      gap_jitter_ms: 100,
      max_repeats: 3,
      gap_growth: 2,
      long_wait_ms: 40000,
      pools: { ja: fillerPool({ first: ["first"], repeat: ["another"] }) },
    });

    // The untouched phrase keeps its audio.
    await synth("first");
    expect(synthCalls()).toHaveLength(2);

    // The edited-out phrase lost its audio: back in the pool, it synthesizes again.
    state.setFillerConfig({
      gap_ms: 1_000,
      gap_jitter_ms: 100,
      max_repeats: 3,
      gap_growth: 2,
      long_wait_ms: 40000,
      pools: { ja: fillerPool({ first: ["first"], repeat: ["repeat"] }) },
    });
    await synth("repeat");
    expect(synthCalls()).toHaveLength(3);
  });

  it("reads pipeline, sink, filler, and VAD settings at call time", async () => {
    const state = setup();
    const pipeline = playbackOptions().pipeline!;
    const sinkOptions = mocks.captured.audioSink as NonNullable<
      Parameters<typeof import("../../../io/voice/tts/audio-player").createWebAudioSink>[0]
    >;

    expect(typeof pipeline.maxInflight).toBe("function");
    expect((pipeline.maxInflight as () => number)()).toBe(1);
    state.setEndpoints(endpoints({ tts_max_inflight: 4 }));
    expect((pipeline.maxInflight as () => number)()).toBe(4);

    expect(sinkOptions.getGain!()).toBe(2);
    state.setGain(5);
    expect(sinkOptions.getGain!()).toBe(5);

    expect(fillerOptions().getTiming()).toEqual({
      gapMs: 1_000,
      jitterMs: 100,
      maxRepeats: 3,
      gapGrowth: 2,
      longWaitMs: 40000,
    });
    state.setFillerConfig({
      gap_ms: 2_000,
      gap_jitter_ms: 250,
      max_repeats: 5,
      gap_growth: 1.5,
      long_wait_ms: 50000,
      pools: {},
    });
    expect(fillerOptions().getTiming()).toEqual({
      gapMs: 2_000,
      jitterMs: 250,
      maxRepeats: 5,
      gapGrowth: 1.5,
      longWaitMs: 50000,
    });

    await state.voice.createSttEngine();
    const sttOptions = mocks.captured.sttVad as SttVadOptions;
    expect((sttOptions.silenceMs as () => number)()).toBe(1_500);
    state.setSilenceMs(900);
    expect((sttOptions.silenceMs as () => number)()).toBe(900);
  });

  describe("backend utterance lifecycle", () => {
    it("hands both utterance callbacks to speech playback", () => {
      const state = setup();
      const identity = { turn_id: "7", event_name: "user.text_submitted" };
      playbackOptions().onUtteranceStart?.(identity);
      expect(state.onUtteranceStart).toHaveBeenCalledWith(identity);
      expect(playbackOptions().onUtteranceEnd).toBe(state.onUtteranceEnd);
    });

    it("the filler loop speaks as an aside", () => {
      setup();
      fillerOptions().speak("えーと");
      expect(mocks.speechPlayback.speakAside).toHaveBeenCalledWith("えーと");
      expect(mocks.speechPlayback.onSpeech).not.toHaveBeenCalled();
      expect(mocks.speechPlayback.onSpeechEnd).not.toHaveBeenCalled();
    });
  });

  it("notifies the filler loop when speech playback ends", () => {
    setup();
    playbackOptions().onPlaybackEnd!();
    expect(mocks.fillerLoop.onUtteranceDone).toHaveBeenCalledOnce();
  });

  it("wires STT callbacks, state, credentials, and a live endpoints getter (#611)", async () => {
    const state = setup();
    const snapshot = endpoints({ stt_base_url: "http://snapshot.test/v1" });
    state.setEndpoints(snapshot);
    const selectedFetch = vi.fn<typeof fetch>();
    mocks.selectFetch.mockResolvedValueOnce(selectedFetch);
    const result = await state.voice.createSttEngine();
    const options = mocks.captured.sttVad as SttVadOptions;

    expect(result).toBe(mocks.sttVad);
    expect(mocks.selectFetch).toHaveBeenCalled();
    expect(options.fetch).toBe(selectedFetch);
    expect(typeof options.config).toBe("function");
    expect((options.config as () => EndpointsConfig)()).toBe(snapshot);

    // A settings-UI override applied after the engine was created must be read on the next
    // resolve — the bug this locks was the engine capturing a static snapshot at construction.
    const overridden = endpoints({ stt_base_url: "http://override.test/v1" });
    state.setEndpoints(overridden);
    expect((options.config as () => EndpointsConfig)()).toBe(overridden);

    options.onSpeechActive!();
    expect(state.onSpeechActive).toHaveBeenCalledOnce();
    expect(options.getApiKey).toBe(state.getSttApiKey);
    options.onVoiceSegment("transcript");
    options.onState!("error", "detail");
    expect(state.onVoiceSegment).toHaveBeenCalledWith("transcript");
    expect(state.voiceInputStatus.set).toHaveBeenCalledWith("error", "detail");
  });

  it("stops filler playback and disposes speech playback", () => {
    const { voice } = setup();
    voice.dispose();
    expect(mocks.fillerLoop.stop).toHaveBeenCalledOnce();
    expect(mocks.speechPlayback.dispose).toHaveBeenCalledOnce();
  });
});
