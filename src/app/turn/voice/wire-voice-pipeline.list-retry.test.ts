// @vitest-environment jsdom
/**
 * The pet's voice list across a TTS server that was down at boot: the real speaker store, voice
 * list refresh and voices client feed the pipeline; only fetch and the audio sink are faked.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = { serverUp: false };
  const calls: string[] = [];
  const fetchImpl = vi.fn<typeof globalThis.fetch>(async (url) => {
    const u = String(url);
    calls.push(u);
    if (!state.serverUp) throw new TypeError(`error sending request for url (${u})`);
    if (u.endsWith("/v1/audio/voices")) {
      return new Response(JSON.stringify({ data: [{ id: "natsume" }] }), { status: 200 });
    }
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      arrayBuffer: async () => new ArrayBuffer(4),
      json: async () => ({}),
    } as unknown as Response;
  });
  const sink = { play: vi.fn(async () => {}), stop: vi.fn() };
  return {
    state,
    calls,
    fetchImpl,
    sink,
    createWebAudioSink: vi.fn<
      typeof import("../../../io/voice/tts/audio-player").createWebAudioSink
    >(() => sink),
    selectFetch: vi.fn<typeof import("../../../io/chat/stream/chat-client").selectFetch>(
      async () => fetchImpl,
    ),
  };
});

vi.mock("../../../io/voice/tts/audio-player", () => ({
  createWebAudioSink: mocks.createWebAudioSink,
}));
vi.mock("../../../io/chat/stream/chat-client", () => ({ selectFetch: mocks.selectFetch }));

import type { EndpointsConfig } from "../../../contract";
import { createTurnLog } from "../../../dispatcher/turn/turn";
import { fillerPool } from "../../../io/voice/filler/filler-test-helpers";
import { wireSpeakerSelection } from "../../settings/wire-avatar";
import { type VoicePipeline, wireVoicePipeline } from "./wire-voice-pipeline";

const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const IDENTITY = { turn_id: "7", event_name: "user.text_submitted" };
const EPS = {
  chat_base_url: "http://chat.test/v1",
  stt_base_url: "http://stt.test/v1",
  tts_base_url: "http://tts.test",
  tts_provider: "irodori",
  tts_speaker: "natsume",
} as EndpointsConfig;

const wired: VoicePipeline[] = [];
const surfaces = {
  beginSpeech: vi.fn(),
  pushSpeech: vi.fn(),
  endSpeech: vi.fn(),
  finishSpeech: vi.fn(),
};

/**
 * Wires the pet's speaker store and voice pipeline, then runs the boot voice list refresh. With
 * filler on, the failure-line prewarm's voice list request settles first.
 */
async function boot(opts: { filler?: boolean } = {}) {
  const speaker = wireSpeakerSelection({
    getEndpoints: () => EPS,
    log,
    broadcastSettings: () => {},
  });
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
    getEndpoints: () => EPS,
    getFillerConfig: () => ({
      gap_ms: 1_000,
      gap_jitter_ms: 0,
      max_repeats: 3,
      gap_growth: 1,
      long_wait_ms: 40000,
      pools: opts.filler ? { ja: fillerPool({ unreachable: ["ちょっと待ってね。"] }) } : {},
    }),
    getTtsApiKey: async () => undefined,
    getSttApiKey: async () => undefined,
    ttsSettings: { get: () => ({ enabled: true }) },
    oneVoiceSettings: { get: () => ({ enabled: false }) },
    lipsyncSettings: { get: () => ({ gain: 1 }) },
    fillerSettings: {
      get: () => ({ enabled: opts.filler ?? false, language: "ja" as const, customPools: {} }),
    },
    readingsSettings: { get: () => ({ text: "" }) },
    vadSettings: { get: () => ({ silenceMs: 1_500, bargeIn: false }) },
    speakerSelection: speaker.speakerSelection,
    refreshVoiceList: speaker.refreshVoiceList,
    checkTtsServer: speaker.checkTtsServer,
    voiceInputStatus: { set: vi.fn() },
    onVoiceSegment: vi.fn(),
    onUtteranceStart: vi.fn(),
    onUtteranceEnd: vi.fn(),
    isStrolling: () => false,
  });
  wired.push(voice);
  if (opts.filler) await new Promise<void>((resolve) => voice.onTtsReach(() => resolve()));
  await speaker.refreshVoiceList();
  mocks.calls.length = 0;
  return voice;
}

const count = (suffix: string) => mocks.calls.filter((u) => u.endsWith(suffix)).length;

describe("wireVoicePipeline voice list retry", () => {
  afterEach(() => {
    for (const voice of wired.splice(0)) voice.dispose();
    mocks.calls.length = 0;
    mocks.state.serverUp = false;
    surfaces.finishSpeech.mockClear();
    localStorage.clear();
  });

  it("speaks the next reply once a server that was down at boot comes up", async () => {
    const voice = await boot();
    mocks.state.serverUp = true;

    voice.turnOutput.speak("こんにちは。", IDENTITY);

    await vi.waitFor(() => expect(surfaces.finishSpeech).toHaveBeenCalledOnce());
    expect(count("/v1/audio/speech")).toBe(1);
  });

  it("speaks a reply after a failed failure-line prewarm once the server comes up", async () => {
    const voice = await boot({ filler: true });
    mocks.state.serverUp = true;

    voice.turnOutput.speak("こんにちは。", IDENTITY);

    await vi.waitFor(() => expect(surfaces.finishSpeech).toHaveBeenCalledOnce());
    expect(count("/v1/audio/speech")).toBe(1);
  });

  it("asks for the voice list once for a three-sentence reply while the server is down", async () => {
    const voice = await boot();

    voice.turnOutput.speak("こんにちは。元気？またね。", IDENTITY);

    await vi.waitFor(() => expect(surfaces.finishSpeech).toHaveBeenCalledOnce());
    expect(count("/v1/audio/voices")).toBe(1);
  });

  it("reports a synth with no answer as unreachable, not as a voice failure", async () => {
    mocks.state.serverUp = true;
    const voice = await boot();
    const synthFailure = vi.fn();
    const reach = vi.fn();
    voice.onSynthFailure(synthFailure);
    voice.onTtsReach(reach);
    mocks.state.serverUp = false;

    voice.turnOutput.speak("こんにちは。", IDENTITY);

    await vi.waitFor(() => expect(surfaces.finishSpeech).toHaveBeenCalledOnce());
    expect(reach.mock.calls).toEqual([["unreachable"]]);
    expect(synthFailure).not.toHaveBeenCalled();
  });
});
