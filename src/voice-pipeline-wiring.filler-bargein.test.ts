/**
 * Filler scheduling after a barge-in, across the real speech path.
 *
 * Only the audio sink, fetch and the STT engine are faked: the sink never finishes the filler it is
 * handed, so barge-in lands mid-utterance, and the assertions count the utterances that reach the
 * speakers after the user started talking.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  // Never resolves — the filler stays mid-playback for the whole test.
  const sink = { play: vi.fn(() => new Promise<void>(() => {})), stop: vi.fn() };
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
  const captured: Record<string, unknown> = {};
  const sttVad = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
  return {
    sink,
    fetchImpl,
    captured,
    sttVad,
    createWebAudioSink: vi.fn(() => sink),
    selectFetch: vi.fn(async () => fetchImpl),
    createSttVad: vi.fn((options: unknown) => {
      captured.sttVad = options;
      return sttVad;
    }),
  };
});

vi.mock("./io/audio-player", () => ({ createWebAudioSink: mocks.createWebAudioSink }));
vi.mock("./io/chat-client", () => ({ selectFetch: mocks.selectFetch }));
vi.mock("./io/stt-vad", () => ({ createSttVad: mocks.createSttVad }));

import { createTurnLog } from "./dispatcher/turn";
import type { SttVadOptions } from "./io/stt-vad";
import { type VoicePipeline, wireVoicePipeline } from "./voice-pipeline-wiring";

const PHRASE = "えーっと。";

// Yields the macrotask queue, which is where a gap-0 filler timer and its playback land.
async function drainTimers(cycles: number): Promise<void> {
  for (let i = 0; i < cycles; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const wired: VoicePipeline[] = [];

function setup(): { voice: VoicePipeline; turnLog: ReturnType<typeof createTurnLog> } {
  const turnLog = createTurnLog();
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
    turnLog,
    getEndpoints: () => ({
      chat_base_url: "http://chat.test/v1",
      chat_endpoint: "/responses",
      stt_base_url: "http://stt.test/v1",
      tts_base_url: "http://tts.test",
    }),
    // gap 0 so a rescheduled filler cycle lands on the next macrotask instead of a wall-clock wait.
    getFillerConfig: () => ({
      gap_ms: 0,
      gap_jitter_ms: 0,
      max_repeats: 1000,
      gap_growth: 1, long_wait_ms: 40000,
      pools: {},
    }),
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
    vadSettings: { get: () => ({ silenceMs: 1_500, bargeIn: true }) },
    speakerSelection: { getActive: () => ({ id: "speaker-a", ref_url: "/speaker-a.wav" }) },
    voiceInputStatus: { set: vi.fn() },
    onVoiceSegment: vi.fn(),
  });
  wired.push(voice);
  return { voice, turnLog };
}

describe("filler scheduling after a barge-in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const voice of wired.splice(0)) voice.dispose();
  });

  it("speaks no further filler once the user barged in mid-utterance", async () => {
    const { voice, turnLog } = setup();
    await voice.createSttEngine();
    const onSpeechActive = (mocks.captured.sttVad as SttVadOptions).onSpeechActive!;

    turnLog.begin({ source: "user_input_source", event_name: "test", ts: 0 });
    voice.turnOutput.thinkingStart(1);
    await vi.waitFor(() => expect(mocks.sink.play).toHaveBeenCalledTimes(1));

    // The user talks over the filler: the utterance is cut and can never report completion.
    expect(turnLog.isAudioOwed()).toBe(true);
    onSpeechActive();

    // The muted turn completes on the non-streaming path, which still ends thinking-window speech.
    voice.turnOutput.speak("こんにちは");
    await drainTimers(20);

    expect(mocks.sink.play).toHaveBeenCalledTimes(1);
    voice.turnOutput.thinkingEnd(1);
  });
});
