/**
 * Filler scheduling after a synth failure with audio already in the cache, across the real speech path.
 *
 * Only the audio sink and fetch are faked: the fetch starts healthy, warms the cache through the
 * production stripper/segmenter, then goes unreachable mid-session. The assertions count the synth
 * requests the wiring puts on the network and the buffers that still reach the sink afterwards.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = { serverDown: false };
  const sink = { play: vi.fn(async () => {}), stop: vi.fn() };
  const fetchImpl = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async (url) => {
    if (String(url).endsWith("/v1/audio/speech") && state.serverDown) {
      throw new TypeError("error sending request for url (http://tts.test/v1/audio/speech)");
    }
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      arrayBuffer: async () => new ArrayBuffer(4),
      json: async () => ({}),
    } as unknown as Response;
  });
  return {
    state,
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

const UNCACHED = "えーっと。";
const CACHED = "ちょっと待ってね。";
const TWO_SENTENCES = "うーん。ちょっと待ってね。";

function synthCalls(): number {
  return mocks.fetchImpl.mock.calls.filter(([url]) => String(url).endsWith("/v1/audio/speech"))
    .length;
}

function plays(): number {
  return mocks.sink.play.mock.calls.length;
}

// Yields the macrotask queue, which is where a gap-0 filler timer and its synth attempt land.
async function drainTimers(cycles: number): Promise<void> {
  for (let i = 0; i < cycles; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const wired: VoicePipeline[] = [];

function setup(customPool: FillerPool): VoicePipeline {
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
      tts_provider: "openai",
    }),
    // gap 0 so every filler cycle lands on the next macrotask instead of a wall-clock wait.
    getFillerConfig: () => ({ gap_ms: 0, gap_jitter_ms: 0, pools: {} }),
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
  wired.push(voice);
  return voice;
}

// Speaks one whole utterance while the server is up, leaving its audio in the cache.
async function warm(voice: VoicePipeline, text: string, segments: number): Promise<void> {
  const before = plays();
  voice.speechPlayback.onSpeech(text);
  await vi.waitFor(() => expect(plays()).toBe(before + segments));
}

describe("filler scheduling after a synth failure with a warm cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.serverDown = false;
  });

  afterEach(() => {
    for (const voice of wired.splice(0)) voice.dispose();
    mocks.state.serverDown = false;
  });

  it("keeps playing cached filler for the rest of the window with no further synth attempts", async () => {
    const voice = setup({ first: [UNCACHED], repeat: [CACHED] });

    await warm(voice, CACHED, 1);
    expect(synthCalls()).toBe(1);

    mocks.state.serverDown = true;
    voice.turnOutput.thinkingStart(1);

    // The first-pool phrase has no cached audio: one attempt, and it fails.
    await vi.waitFor(() => expect(synthCalls()).toBe(2));

    // The repeat pool is cached, so filler keeps speaking without touching the network.
    await vi.waitFor(() => expect(plays()).toBeGreaterThanOrEqual(4));
    await drainTimers(20);
    expect(synthCalls()).toBe(2);

    voice.turnOutput.thinkingEnd(1);
  });

  it("does not pick a phrase whose sentences are only partly cached", async () => {
    const voice = setup({ first: [UNCACHED], repeat: [TWO_SENTENCES] });

    // Only the first of the two sentences gets audio.
    await warm(voice, "うーん。", 1);
    expect(synthCalls()).toBe(1);

    mocks.state.serverDown = true;
    voice.turnOutput.thinkingStart(1);

    await vi.waitFor(() => expect(synthCalls()).toBe(2));
    await drainTimers(30);

    // Picking the half-cached phrase would put its second sentence on the network.
    expect(synthCalls()).toBe(2);
    expect(plays()).toBe(1);

    voice.turnOutput.thinkingEnd(1);
  });
});
