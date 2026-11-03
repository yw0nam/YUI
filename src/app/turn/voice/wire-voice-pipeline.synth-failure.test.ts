/**
 * The pipeline-owned synth-failure listeners across the real speech path.
 *
 * Only the audio sink and fetch are faked, so the TTS_SKIP-versus-real-rejection decision in
 * tts-pipeline runs unmocked: a real rejection reaches the subscriber once, a silent skip never.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

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

vi.mock("../../../io/voice/tts/audio-player", () => ({
  createWebAudioSink: mocks.createWebAudioSink,
}));
vi.mock("../../../io/chat/stream/chat-client", () => ({ selectFetch: mocks.selectFetch }));

import { createTurnLog } from "../../../dispatcher/turn/turn";
import { type VoicePipeline, wireVoicePipeline } from "./wire-voice-pipeline";

const surfaces = {
  beginSpeech: vi.fn(),
  pushSpeech: vi.fn(),
  endSpeech: vi.fn(),
  finishSpeech: vi.fn(),
};

const IDENTITY = { turn_id: "7", event_name: "user.text_submitted" };

// Yields the macrotask queue so a settled-but-not-yet-observed failure could still land.
async function drainTimers(cycles: number): Promise<void> {
  for (let i = 0; i < cycles; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const wired: VoicePipeline[] = [];

function setup(over: { ttsEnabled?: () => boolean } = {}): VoicePipeline {
  const voice = wireVoicePipeline({
    renderer: {
      setMouthOpen: vi.fn(),
      stopMouth: vi.fn(),
      easeEmotionToNeutral: vi.fn(),
      applyDirective: vi.fn(),
      playMotion: vi.fn(),
    },
    surfaces,
    turnLog: createTurnLog(),
    getEndpoints: () => ({
      chat_base_url: "http://chat.test/v1",
      stt_base_url: "http://stt.test/v1",
      tts_base_url: "http://tts.test",
    }),
    getFillerConfig: () => ({
      gap_ms: 1_000,
      gap_jitter_ms: 0,
      max_repeats: 3,
      gap_growth: 1,
      long_wait_ms: 40000,
      pools: {},
    }),
    getTtsApiKey: vi.fn().mockResolvedValue(undefined),
    getSttApiKey: vi.fn().mockResolvedValue(undefined),
    ttsSettings: { get: () => ({ enabled: over.ttsEnabled?.() ?? true }) },
    oneVoiceSettings: { get: () => ({ enabled: false }) },
    lipsyncSettings: { get: () => ({ gain: 1 }) },
    fillerSettings: {
      get: () => ({ enabled: true, language: "ja" as const, customPools: {} }),
    },
    readingsSettings: { get: () => ({ text: "" }) },
    vadSettings: { get: () => ({ silenceMs: 1_500, bargeIn: false }) },
    speakerSelection: { getActive: () => ({ id: "speaker-a", ref_url: "/speaker-a.wav" }) },
    voiceInputStatus: { set: vi.fn() },
    onVoiceSegment: vi.fn(),
    onUtteranceStart: vi.fn(),
    onUtteranceEnd: vi.fn(),
    isStrolling: () => false,
  });
  wired.push(voice);
  return voice;
}

describe("wireVoicePipeline synth-failure listeners", () => {
  afterEach(() => {
    for (const voice of wired.splice(0)) voice.dispose();
    mocks.state.serverDown = false;
  });

  it("a real synth rejection calls the subscribed listener once per failed sentence", async () => {
    const voice = setup();
    const cb = vi.fn();
    voice.onSynthFailure(cb);

    mocks.state.serverDown = true;
    voice.turnOutput.speak("ちょっと待ってね。", IDENTITY);

    await vi.waitFor(() => expect(cb).toHaveBeenCalledTimes(1));
    await drainTimers(10);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("a TTS_SKIP rejection never calls the subscribed listener", async () => {
    const voice = setup({ ttsEnabled: () => false });
    const cb = vi.fn();
    voice.onSynthFailure(cb);

    voice.turnOutput.speak("ちょっと待ってね。", IDENTITY);

    // The skipped utterance still closes: onPlaybackEnd runs without ever failing a synth.
    await vi.waitFor(() => expect(surfaces.finishSpeech).toHaveBeenCalledOnce());
    expect(cb).not.toHaveBeenCalled();
  });

  it("unsubscribing stops later failures from reaching the listener", async () => {
    const voice = setup();
    const cb = vi.fn();
    const off = voice.onSynthFailure(cb);
    off();

    mocks.state.serverDown = true;
    voice.turnOutput.speak("ちょっと待ってね。", IDENTITY);

    await vi.waitFor(() => expect(surfaces.finishSpeech).toHaveBeenCalledOnce());
    expect(cb).not.toHaveBeenCalled();
  });
});
