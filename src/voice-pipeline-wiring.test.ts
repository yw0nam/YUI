import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const captured: Record<string, unknown> = {};
  const speechPlayback = {
    onSpeechDelta: vi.fn(),
    onSpeechEnd: vi.fn(),
    onSpeech: vi.fn(),
    setCue: vi.fn(),
    holdMotion: vi.fn(),
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
    selectFetch: vi.fn().mockResolvedValue(fetchImpl),
    // Voice-import-flow fakes, used only by the cross-window re-import test below — drives the
    // settings-window side with the real commitVoiceImport instead of hand-writing its effects.
    upsertVoice: vi.fn().mockResolvedValue(undefined),
    copyVoiceFile: vi.fn(),
  };
});

vi.mock("./io/speech-playback", () => ({
  createSpeechPlayback: mocks.createSpeechPlayback,
}));
vi.mock("./io/filler-loop", () => ({ createFillerLoop: mocks.createFillerLoop }));
vi.mock("./io/stt-vad", () => ({ createSttVad: mocks.createSttVad }));
vi.mock("./io/tts-pipeline", () => ({ TTS_SKIP: mocks.ttsSkip }));
vi.mock("./io/tts-voices", () => ({ upsertVoice: mocks.upsertVoice }));
vi.mock("./io/audio-player", () => ({ createWebAudioSink: mocks.createWebAudioSink }));
vi.mock("./io/chat-client", () => ({ selectFetch: mocks.selectFetch }));
vi.mock("./io/voice-import", () => ({
  copyVoiceFile: mocks.copyVoiceFile,
  pickVoiceFile: vi.fn(),
  removeOrphanVoice: vi.fn(),
  removeUserVoice: vi.fn().mockResolvedValue(undefined),
  fileStemFromPath: (path: string) => path,
}));

import type { FillerConfig } from "./config/load";
import type { EndpointsConfig } from "./contract";
import type { BusEnvelope } from "./dispatcher/event-bus";
import { createTurnLog } from "./dispatcher/turn";
import type { FillerLoopDeps } from "./io/filler-loop";
import {
  createSpeakerSelection,
  localStorageSpeakerStorage,
  localStorageUserSpeakerStorage,
  type SpeakerOption,
} from "./io/speaker-selection";
import type { SpeechPlaybackOptions } from "./io/speech-playback";
import type { SttVadOptions } from "./io/stt-vad";
import { createVoiceImportFlow } from "./io/voice-import-flow";
import { wireVoicePipeline } from "./voice-pipeline-wiring";

const noopLog = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

// In-memory Storage stand-in shared by two speakerSelection instances, so they behave like the
// same localStorage two real windows would share (jsdom/window are not available in this file's
// node test environment).
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
    chat_endpoint: "/responses",
    stt_base_url: "http://stt.test/v1",
    tts_base_url: "http://tts.test",
    tts_model: "irodori-tts",
    ...overrides,
  };
}

function trigger(): BusEnvelope {
  return { source: "user_input_source", event_name: "test", ts: 0 };
}

// Fetch calls the synth path makes: POST {tts_base_url}/v1/audio/speech.
function synthCalls(): unknown[][] {
  return mocks.fetchImpl.mock.calls.filter(([url]) => String(url).endsWith("/v1/audio/speech"));
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
    turnLog,
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
    vi.clearAllMocks();
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

  it("A's late thinkingEnd(idA) does not tear down B's thinking once B's thinkingStart(idB) has begun", () => {
    const { voice, renderer } = setup();

    voice.turnOutput.thinkingStart(1); // A starts
    voice.turnOutput.thinkingStart(2); // B starts before A's late end arrives
    vi.clearAllMocks();
    voice.turnOutput.thinkingEnd(1); // A's late end

    expect(mocks.speechPlayback.holdMotion).not.toHaveBeenCalled();
    expect(mocks.fillerLoop.stop).not.toHaveBeenCalled();
    expect(renderer.playMotion).not.toHaveBeenCalled();

    voice.turnOutput.thinkingEnd(2); // B's own end
    expect(mocks.speechPlayback.holdMotion).toHaveBeenCalledWith(false);
    expect(mocks.fillerLoop.stop).toHaveBeenCalledOnce();
    expect(renderer.playMotion).toHaveBeenCalledWith(null);
  });

  it("a turn's own thinkingEnd tears down even after a newer turn begins on the ledger without starting its own thinking", () => {
    const { voice, renderer, turnLog } = setup();

    turnLog.begin(trigger());
    voice.turnOutput.thinkingStart(1);
    // the ledger moves on, but the new turn never claims thinking — the guard ignores it.
    turnLog.begin(trigger());
    voice.turnOutput.thinkingEnd(1);

    expect(mocks.speechPlayback.holdMotion).toHaveBeenCalledWith(false);
    expect(mocks.fillerLoop.stop).toHaveBeenCalledOnce();
    expect(renderer.playMotion).toHaveBeenCalledWith(null);
  });

  it("holds motion before starting the thinking motion and filler", () => {
    const { voice, renderer } = setup();

    voice.turnOutput.thinkingStart(1);

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
      mocks.copyVoiceFile.mockResolvedValue({
        id: "myvoice",
        label: "My Voice",
        ref_url: "/myvoice-v2.wav",
        source: "user",
      });
      const { commitVoiceImport: commitOnWindowA } = createVoiceImportFlow({
        getTtsBaseUrl: () => "http://tts.test",
        speakerSelection: windowA,
        log: noopLog,
      });

      // Window B loads the already-persisted option at construction time, same as opening the
      // pet window after a voice was imported in a prior session.
      const windowB = createSpeakerSelection({ defaultValue: "", ...storageOpts() });
      // Production wires speakerSelection.subscribe(broadcastSettings), which (via the bridge and
      // the other window's onSettingsChanged, see bootstrap-wiring.ts) ends in the other window's
      // reloadFromStorage() — that glue is covered by settings-window.test.ts/bootstrap-wiring.test.ts.
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
          pools: { ja: { first: ["first"], repeat: ["repeat"] } },
        }),
        getTtsApiKey: vi.fn().mockResolvedValue(undefined),
        getSttApiKey: vi.fn().mockResolvedValue(undefined),
        ttsSettings: { get: () => ({ enabled: true }) },
        lipsyncSettings: { get: () => ({ gain: 1 }) },
        fillerSettings: { get: () => ({ enabled: true, language: "ja", customPools: {} }) },
        vadSettings: { get: () => ({ silenceMs: 1_500, bargeIn: false }) },
        speakerSelection: windowB,
        voiceInputStatus: { set: vi.fn() },
        onVoiceSegment: vi.fn(),
      });
      const synth = playbackOptions().pipeline!.synth!;

      await synth("first");
      await synth("first");
      expect(synthCalls()).toHaveLength(1);

      // Window A re-imports "My Voice" under the same name it is already active under — same id,
      // new clip, no selection change. This is the #506 scenario: re-importing the active voice.
      await commitOnWindowA("/tmp/MyVoice.wav", "My Voice");

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
      pools: { ja: { first: ["first"], repeat: ["another"] } },
    });

    // The untouched phrase keeps its audio.
    await synth("first");
    expect(synthCalls()).toHaveLength(2);

    // The edited-out phrase lost its audio: back in the pool, it synthesizes again.
    state.setFillerConfig({
      gap_ms: 1_000,
      gap_jitter_ms: 100,
      pools: { ja: { first: ["first"], repeat: ["repeat"] } },
    });
    await synth("repeat");
    expect(synthCalls()).toHaveLength(3);
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

    await state.voice.createSttEngine();
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

    expect(options.getApiKey).toBe(state.getSttApiKey);
    options.onVoiceSegment("transcript");
    options.onState!("error", "detail");
    expect(state.onVoiceSegment).toHaveBeenCalledWith("transcript");
    expect(state.voiceInputStatus.set).toHaveBeenCalledWith("error", "detail");
  });

  it("interrupts active playback only when barge-in is enabled", async () => {
    const state = setup();
    await state.voice.createSttEngine();
    const onSpeechActive = (mocks.captured.sttVad as SttVadOptions).onSpeechActive!;

    onSpeechActive();
    expect(mocks.speechPlayback.interrupt).not.toHaveBeenCalled();

    state.setBargeIn(true);
    onSpeechActive();
    expect(mocks.speechPlayback.interrupt).not.toHaveBeenCalled();

    state.turnLog.begin(trigger());
    state.turnLog.setAudioOwed(true);
    onSpeechActive();
    expect(mocks.speechPlayback.interrupt).toHaveBeenCalledWith({ muteCurrentTurn: true });
  });

  it("stops the filler loop when barge-in interrupts", async () => {
    const state = setup();
    await state.voice.createSttEngine();
    const onSpeechActive = (mocks.captured.sttVad as SttVadOptions).onSpeechActive!;

    state.setBargeIn(true);
    state.turnLog.begin(trigger());
    state.voice.turnOutput.thinkingStart(1);
    state.turnLog.setAudioOwed(true);
    onSpeechActive();

    // The interrupted utterance is disposed, so its onPlaybackEnd can never reschedule the loop.
    expect(mocks.fillerLoop.stop).toHaveBeenCalledOnce();
  });

  it("stops filler playback and disposes speech playback", () => {
    const { voice } = setup();
    voice.dispose();
    expect(mocks.fillerLoop.stop).toHaveBeenCalledOnce();
    expect(mocks.speechPlayback.dispose).toHaveBeenCalledOnce();
  });
});
