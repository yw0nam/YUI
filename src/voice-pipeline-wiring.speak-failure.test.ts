/**
 * voice-pipeline-wiring.speak-failure.test.ts — spoken failure lines + their prewarm.
 *
 * Only the audio sink and fetch are faked; the real speech path (speechPlayback → TTS synth →
 * sink) plays out so a failure phrase's audio can be observed reaching the sink.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const sink = { play: vi.fn(async () => {}), stop: vi.fn() };
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
    sink,
    fetchImpl,
    createWebAudioSink: vi.fn(() => sink),
    selectFetch: vi.fn(async () => fetchImpl),
  };
});

vi.mock("./io/audio-player", () => ({ createWebAudioSink: mocks.createWebAudioSink }));
vi.mock("./io/chat-client", () => ({ selectFetch: mocks.selectFetch }));

import type { FillerPool } from "./config/load";
import { createTurnLog } from "./dispatcher/turn";
import type { FillerSettings } from "./io/filler-settings";
import { type VoicePipeline, wireVoicePipeline } from "./voice-pipeline-wiring";

const TIMEOUT_PHRASE = "ごめん、諦めちゃった。";
const UNREACHABLE_PHRASE = "今つながらないみたい。";

function pool(overrides: Partial<FillerPool> = {}): FillerPool {
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

function synthCalls(): unknown[][] {
  return mocks.fetchImpl.mock.calls.filter(([url]) => String(url).endsWith("/v1/audio/speech"));
}

function synthInputs(): string[] {
  return synthCalls().map(([, init]) => JSON.parse((init as RequestInit).body as string).input);
}

const wired: VoicePipeline[] = [];

function setup(
  getSettings: () => FillerSettings,
  subscribe?: (cb: (s: FillerSettings) => void) => () => void,
): VoicePipeline {
  const voice = wireVoicePipeline({
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
    getEndpoints: () => ({
      chat_base_url: "http://chat.test/v1",
      chat_endpoint: "/responses",
      stt_base_url: "http://stt.test/v1",
      tts_base_url: "http://tts.test",
    }),
    getFillerConfig: () => ({
      gap_ms: 0,
      gap_jitter_ms: 0,
      max_repeats: 3,
      gap_growth: 2, long_wait_ms: 40000,
      pools: {},
    }),
    getTtsApiKey: vi.fn().mockResolvedValue(undefined),
    getSttApiKey: vi.fn().mockResolvedValue(undefined),
    ttsSettings: { get: () => ({ enabled: true }) },
    lipsyncSettings: { get: () => ({ gain: 1 }) },
    fillerSettings: { get: getSettings, subscribe },
    vadSettings: { get: () => ({ silenceMs: 1_500, bargeIn: false }) },
    speakerSelection: { getActive: () => ({ id: "speaker-a", ref_url: "/speaker-a.wav" }) },
    voiceInputStatus: { set: vi.fn() },
    onVoiceSegment: vi.fn(),
  });
  wired.push(voice);
  return voice;
}

function settingsOf(customPool: FillerPool): FillerSettings {
  return { enabled: true, language: "ja", customPools: { ja: customPool } };
}

describe("speakFailure", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    for (const voice of wired.splice(0)) voice.dispose();
  });

  it("network_stall speaks a phrase from the timeout pool and ends the utterance", async () => {
    const voice = setup(() => settingsOf(pool({ timeout: [TIMEOUT_PHRASE] })));
    voice.speakFailure("network_stall");
    await vi.waitFor(() => expect(mocks.sink.play).toHaveBeenCalled());
    expect(synthInputs()).toContain(TIMEOUT_PHRASE);
  });

  it("network_drop speaks a phrase from the unreachable pool", async () => {
    const voice = setup(() => settingsOf(pool({ unreachable: [UNREACHABLE_PHRASE] })));
    voice.speakFailure("network_drop");
    await vi.waitFor(() => expect(mocks.sink.play).toHaveBeenCalled());
    expect(synthInputs()).toContain(UNREACHABLE_PHRASE);
  });

  it("does nothing for a reason other than network_stall/network_drop", async () => {
    const voice = setup(() =>
      settingsOf(pool({ timeout: [TIMEOUT_PHRASE], unreachable: [UNREACHABLE_PHRASE] })),
    );
    voice.speakFailure("not_configured");
    voice.speakFailure("parse_error");
    voice.speakFailure("http_4xx_drop");
    voice.speakFailure("superseded_by_user");
    // Give any wrongly-fired async speech a chance to land before asserting silence.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.sink.play).not.toHaveBeenCalled();
  });

  it("does nothing when the pool for that tier is empty", async () => {
    const voice = setup(() => settingsOf(pool()));
    voice.speakFailure("network_stall");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.sink.play).not.toHaveBeenCalled();
  });
});

describe("prewarmFailureLines", () => {
  // Real timers would make every one of these wait out the ~2s debounce for real; fake timers let
  // the debounce itself be pinned precisely and cheaply.
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    for (const voice of wired.splice(0)) voice.dispose();
    vi.useRealTimers();
  });

  it("synthesizes every timeout/unreachable sentence once, debounced ~2s after wiring", async () => {
    setup(() => settingsOf(pool({ timeout: [TIMEOUT_PHRASE], unreachable: [UNREACHABLE_PHRASE] })));

    await vi.advanceTimersByTimeAsync(1999);
    expect(synthCalls().length).toBe(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(synthCalls().length).toBe(2);
    expect(synthInputs().sort()).toEqual([TIMEOUT_PHRASE, UNREACHABLE_PHRASE].sort());
  });

  it("skips a sentence already cached — a later speakFailure serves it without a new synth call", async () => {
    const voice = setup(() => settingsOf(pool({ timeout: [TIMEOUT_PHRASE] })));
    await vi.advanceTimersByTimeAsync(2000);
    const before = synthCalls().length;
    expect(before).toBeGreaterThanOrEqual(1);

    voice.speakFailure("network_stall");
    await vi.advanceTimersByTimeAsync(0); // flushes the speak's own synth/playback microtasks
    expect(mocks.sink.play).toHaveBeenCalled();
    expect(synthCalls().length).toBe(before);
  });

  it("re-prewarms when filler settings notify a change, skipping what is already cached", async () => {
    let current = settingsOf(pool({ timeout: [TIMEOUT_PHRASE] }));
    let notify: ((s: FillerSettings) => void) | undefined;
    setup(
      () => current,
      (cb) => {
        notify = cb;
        return () => {};
      },
    );
    await vi.advanceTimersByTimeAsync(2000);
    const before = synthCalls().length;

    const NEW_PHRASE = "新しい文言。";
    current = settingsOf(pool({ timeout: [TIMEOUT_PHRASE], unreachable: [NEW_PHRASE] }));
    notify?.(current);
    await vi.advanceTimersByTimeAsync(2000);

    expect(synthInputs()).toContain(NEW_PHRASE);
    // The already-cached timeout sentence is not resynthesized — only the new one adds a call.
    expect(synthCalls().length).toBe(before + 1);
  });

  it("does nothing when the sentence set notifies a change but is unchanged since the last prewarm", async () => {
    let current = settingsOf(pool({ timeout: [TIMEOUT_PHRASE] }));
    let notify: ((s: FillerSettings) => void) | undefined;
    setup(
      () => current,
      (cb) => {
        notify = cb;
        return () => {};
      },
    );
    await vi.advanceTimersByTimeAsync(2000);
    const before = synthCalls().length;

    // A different settings object, but the same sentence set — nothing to redo.
    current = settingsOf(pool({ timeout: [TIMEOUT_PHRASE] }));
    notify?.(current);
    await vi.advanceTimersByTimeAsync(2000);

    expect(synthCalls().length).toBe(before);
  });

  it("debounces three rapid settings commits into one synth batch", async () => {
    let current = settingsOf(pool({ timeout: [] }));
    let notify: ((s: FillerSettings) => void) | undefined;
    setup(
      () => current,
      (cb) => {
        notify = cb;
        return () => {};
      },
    );
    await vi.advanceTimersByTimeAsync(2000); // let the initial (empty) prewarm settle — nothing to do
    expect(synthCalls().length).toBe(0);

    current = settingsOf(pool({ timeout: ["a"] }));
    notify?.(current);
    await vi.advanceTimersByTimeAsync(300); // well inside the debounce window
    current = settingsOf(pool({ timeout: ["a", "b"] }));
    notify?.(current);
    await vi.advanceTimersByTimeAsync(300);
    current = settingsOf(pool({ timeout: ["a", "b", "c"] }));
    notify?.(current);

    await vi.advanceTimersByTimeAsync(1900); // still inside the window from the last commit
    expect(synthCalls().length).toBe(0);

    await vi.advanceTimersByTimeAsync(200); // 2s past the last commit — exactly one batch fires
    expect(synthCalls().length).toBe(3);
    expect(synthInputs().sort()).toEqual(["a", "b", "c"]);
  });
});
