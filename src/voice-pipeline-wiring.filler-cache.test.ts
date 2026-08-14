/**
 * Filler-cache membership across the real speech path.
 *
 * Only the audio sink and fetch are faked here: the emoji stripper and the sentence segmenter that
 * sit between a pool phrase and its TTS submission are the production ones. A transform added to
 * the speech path therefore breaks this test instead of silently disabling the cache.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { type VoicePipeline, wireVoicePipeline } from "./voice-pipeline-wiring";

// Custom pool phrases as a user writes them: emoji around the text and a sentence break inside it.
const HESITATE = "🥺少し…⏸️考えさせて。";
const TWO_SENTENCES = "うーん🤔。ちょっと待ってね😒。";

function synthCalls(): number {
  return mocks.fetchImpl.mock.calls.filter(([url]) => String(url).endsWith("/v1/audio/speech"))
    .length;
}

function setup(customPool: FillerPool): VoicePipeline {
  return wireVoicePipeline({
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
      tts_provider: "openai",
    }),
    getFillerConfig: () => ({ gap_ms: 1_000, gap_jitter_ms: 100, pools: {} }),
    getTtsApiKey: vi.fn().mockResolvedValue(undefined),
    getSttApiKey: vi.fn().mockResolvedValue(undefined),
    ttsSettings: { get: () => ({ enabled: true }) },
    lipsyncSettings: { get: () => ({ gain: 1 }) },
    fillerSettings: {
      get: () => ({ enabled: true, language: "ja" as const, customPools: { ja: customPool } }),
    },
    vadSettings: { get: () => ({ silenceMs: 1_500, bargeIn: false }) },
    speakerSelection: { getActive: () => ({ id: "speaker-a", ref_url: "/speaker-a.wav" }) },
    voiceInputStatus: { set: vi.fn() },
    onVoiceSegment: vi.fn(),
  });
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

  it("still re-synthesizes a response sentence that is not in the pool", async () => {
    const voice = setup({ first: [HESITATE], repeat: [] });

    await speak(voice, "今日はいい天気だね。", 1);
    await speak(voice, "今日はいい天気だね。", 1);
    expect(synthCalls()).toBe(2);
  });
});
