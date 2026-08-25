/**
 * Filler-cache membership across the real speech path.
 *
 * Only the audio sink and fetch are faked here: the emoji stripper and the sentence segmenter that
 * sit between a pool phrase and its TTS submission are the production ones. A transform added to
 * the speech path therefore breaks this test instead of silently disabling the cache.
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
import type { SpeakerOption } from "./io/speaker-selection";
import { type VoicePipeline, wireVoicePipeline } from "./voice-pipeline-wiring";

// Custom pool phrases as a user writes them: emoji around the text and a sentence break inside it.
const HESITATE = "🥺少し…⏸️考えさせて。";
const TWO_SENTENCES = "うーん🤔。ちょっと待ってね😒。";
const PHRASE_A = "えーっと。";
const PHRASE_A_EDITED = "えーっとね。";
const PHRASE_B = "ちょっと待ってね。";

const SPEAKER: SpeakerOption = { id: "speaker-a", ref_url: "/speaker-a.wav" };

function synthCalls(): number {
  return mocks.fetchImpl.mock.calls.filter(([url]) => String(url).endsWith("/v1/audio/speech"))
    .length;
}

// Disposed after every case, so a failed assertion can't leave the filler loop running into the next.
const wired: VoicePipeline[] = [];

function setup(
  customPool: FillerPool | (() => FillerPool),
  gapMs = 1_000,
  getSpeaker: () => SpeakerOption = () => SPEAKER,
): VoicePipeline {
  const pool = typeof customPool === "function" ? customPool : () => customPool;
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
    getFillerConfig: () => ({ gap_ms: gapMs, gap_jitter_ms: 0, max_repeats: 1000, gap_growth: 1, pools: {} }),
    getTtsApiKey: vi.fn().mockResolvedValue(undefined),
    getSttApiKey: vi.fn().mockResolvedValue(undefined),
    ttsSettings: { get: () => ({ enabled: true }) },
    lipsyncSettings: { get: () => ({ gain: 1 }) },
    fillerSettings: {
      get: () => ({ enabled: true, language: "ja" as const, customPools: { ja: pool() } }),
    },
    vadSettings: { get: () => ({ silenceMs: 1_500, bargeIn: false }) },
    speakerSelection: { getActive: getSpeaker },
    voiceInputStatus: { set: vi.fn() },
    onVoiceSegment: vi.fn(),
  });
  wired.push(voice);
  return voice;
}

// Speaks one whole utterance and waits until every sentence it splits into has reached the sink.
async function speak(voice: VoicePipeline, text: string, segments: number): Promise<void> {
  const before = mocks.sink.play.mock.calls.length;
  voice.speechPlayback.onSpeech(text);
  await vi.waitFor(() => expect(mocks.sink.play.mock.calls.length).toBe(before + segments));
}

describe("filler audio cache membership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const voice of wired.splice(0)) voice.dispose();
  });

  it("caches a filler phrase whose emoji the speech path strips before submission", async () => {
    const voice = setup({ first: [HESITATE], repeat: [] });

    await speak(voice, HESITATE, 1);
    expect(synthCalls()).toBe(1);

    await speak(voice, HESITATE, 1);
    expect(synthCalls()).toBe(1);
  });

  it("caches every sentence a filler phrase splits into", async () => {
    const voice = setup({ first: [], repeat: [TWO_SENTENCES] });

    await speak(voice, TWO_SENTENCES, 2);
    expect(synthCalls()).toBe(2);

    await speak(voice, TWO_SENTENCES, 2);
    expect(synthCalls()).toBe(2);
  });

  it("keeps filler submissions cue-free when an express cue arrives during thinking", async () => {
    // gap 0 so the loop's repeat lands without waiting; the same phrase in both pools makes the
    // repeat the phrase already cached by the first utterance.
    const voice = setup({ first: [HESITATE], repeat: [HESITATE] }, 0);

    // The turn order the backend caller drives: interrupt, then thinking, then the express cue —
    // which can land before the first speech delta and must stay held until thinking ends.
    voice.turnOutput.interrupt();
    voice.turnOutput.thinkingStart(1);
    voice.turnOutput.cue({ emotion_id: "joy", emotion_text: "[cheerful]" });

    await vi.waitFor(() => expect(mocks.sink.play.mock.calls.length).toBeGreaterThanOrEqual(1));
    expect(synthCalls()).toBe(1);

    // A cue reaching the pipeline would prefix the tag onto the next filler submission, and the
    // cache would miss on text it never stored.
    await vi.waitFor(() => expect(mocks.sink.play.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(synthCalls()).toBe(1);

    voice.turnOutput.thinkingEnd(1);
  });

  it("still re-synthesizes a response sentence that is not in the pool", async () => {
    const voice = setup({ first: [HESITATE], repeat: [] });

    await speak(voice, "今日はいい天気だね。", 1);
    await speak(voice, "今日はいい天気だね。", 1);
    expect(synthCalls()).toBe(2);
  });
});

describe("filler audio cache invalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const voice of wired.splice(0)) voice.dispose();
  });

  it("re-synthesizes only the phrase whose text was edited", async () => {
    let pool: FillerPool = { first: [PHRASE_A], repeat: [PHRASE_B] };
    const voice = setup(() => pool);

    await speak(voice, PHRASE_A, 1);
    await speak(voice, PHRASE_B, 1);
    expect(synthCalls()).toBe(2);

    pool = { first: [PHRASE_A_EDITED], repeat: [PHRASE_B] };

    // The untouched phrase keeps the audio it already has.
    await speak(voice, PHRASE_B, 1);
    expect(synthCalls()).toBe(2);

    // Only the edited phrase is new to the cache.
    await speak(voice, PHRASE_A_EDITED, 1);
    expect(synthCalls()).toBe(3);
  });

  it("re-synthesizes every phrase when the speaker revision changes", async () => {
    let revision = 1;
    const voice = setup({ first: [PHRASE_A], repeat: [PHRASE_B] }, 1_000, () => ({
      ...SPEAKER,
      revision,
    }));

    await speak(voice, PHRASE_A, 1);
    await speak(voice, PHRASE_B, 1);
    expect(synthCalls()).toBe(2);

    revision = 2;

    await speak(voice, PHRASE_A, 1);
    await speak(voice, PHRASE_B, 1);
    expect(synthCalls()).toBe(4);
  });

  it("evicts a phrase that leaves the pool", async () => {
    let pool: FillerPool = { first: [PHRASE_A], repeat: [PHRASE_B] };
    const voice = setup(() => pool);

    await speak(voice, PHRASE_B, 1);
    expect(synthCalls()).toBe(1);

    // Out of the pool it is no longer cacheable text and goes straight to the provider.
    pool = { first: [PHRASE_A], repeat: [] };
    await speak(voice, PHRASE_B, 1);
    expect(synthCalls()).toBe(2);

    // Re-added, it has no audio left to hit.
    pool = { first: [PHRASE_A], repeat: [PHRASE_B] };
    await speak(voice, PHRASE_B, 1);
    expect(synthCalls()).toBe(3);

    await speak(voice, PHRASE_B, 1);
    expect(synthCalls()).toBe(3);
  });
});
