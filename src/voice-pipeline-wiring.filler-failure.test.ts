/**
 * Filler scheduling against an unreachable TTS server, across the real speech path.
 *
 * Only the audio sink and fetch are faked: a rejecting fetch stands in for the dead server, and the
 * assertions count the synth requests the wiring actually puts on the network per thinking window.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const sink = { play: vi.fn(async () => {}), stop: vi.fn() };
  const fetchImpl = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async (url) => {
    if (String(url).endsWith("/v1/audio/speech")) {
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
    sink,
    fetchImpl,
    createWebAudioSink: vi.fn(() => sink),
    selectFetch: vi.fn(async () => fetchImpl),
  };
});

vi.mock("./io/audio-player", () => ({ createWebAudioSink: mocks.createWebAudioSink }));
vi.mock("./io/chat-client", () => ({ selectFetch: mocks.selectFetch }));

import { createTurnLog } from "./dispatcher/turn";
import { type VoicePipeline, wireVoicePipeline } from "./voice-pipeline-wiring";

const PHRASE = "えーっと。";

function synthCalls(): number {
  return mocks.fetchImpl.mock.calls.filter(([url]) => String(url).endsWith("/v1/audio/speech"))
    .length;
}

// Yields the macrotask queue, which is where a gap-0 filler timer and its synth attempt land.
async function drainTimers(cycles: number): Promise<void> {
  for (let i = 0; i < cycles; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const wired: VoicePipeline[] = [];

function setup(): VoicePipeline {
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
    // gap 0 so every filler cycle lands on the next macrotask instead of a wall-clock wait.
    getFillerConfig: () => ({ gap_ms: 0, gap_jitter_ms: 0, max_repeats: 1000, gap_growth: 1, pools: {} }),
    getTtsApiKey: vi.fn().mockResolvedValue(undefined),
    getSttApiKey: vi.fn().mockResolvedValue(undefined),
    ttsSettings: { get: () => ({ enabled: true }) },
    lipsyncSettings: { get: () => ({ gain: 1 }) },
    fillerSettings: {
      get: () => ({
        enabled: true,
        language: "ja" as const,
        customPools: { ja: { first: [PHRASE], repeat: [PHRASE] } },
      }),
    },
    vadSettings: { get: () => ({ silenceMs: 1_500, bargeIn: false }) },
    speakerSelection: { getActive: () => ({ id: "speaker-a", ref_url: "/speaker-a.wav" }) },
    voiceInputStatus: { set: vi.fn() },
    onVoiceSegment: vi.fn(),
  });
  wired.push(voice);
  return voice;
}

describe("filler scheduling after a synth failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const voice of wired.splice(0)) voice.dispose();
  });

  it("attempts synthesis once per thinking window while the server is unreachable", async () => {
    const voice = setup();

    voice.turnOutput.thinkingStart(1);
    await vi.waitFor(() => expect(synthCalls()).toBeGreaterThanOrEqual(1));
    await drainTimers(20);

    expect(synthCalls()).toBe(1);
    voice.turnOutput.thinkingEnd(1);
  });

  it("attempts synthesis again at the next thinking start", async () => {
    const voice = setup();

    voice.turnOutput.thinkingStart(1);
    await vi.waitFor(() => expect(synthCalls()).toBeGreaterThanOrEqual(1));
    await drainTimers(20);
    voice.turnOutput.thinkingEnd(1);

    voice.turnOutput.thinkingStart(2);
    await vi.waitFor(() => expect(synthCalls()).toBe(2));
    await drainTimers(20);

    expect(synthCalls()).toBe(2);
    voice.turnOutput.thinkingEnd(2);
  });
});
