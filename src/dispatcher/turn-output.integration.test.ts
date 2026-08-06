/**
 * turn-output.integration.test.ts — drives backend-caller → TurnOutput → tts-pipeline ordering.
 *
 * Wires a real createBackendCaller to a real createSpeechPlayback through a TurnOutput literal
 * shaped like the one voice-pipeline-wiring.ts builds — only the chat stream, the TTS synth, and
 * the audio sink are faked. Asserts the ordering the port's doc comment promises, not just that
 * calls happened.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioSink } from "../io/audio-player";
import { createSpeechPlayback, type SpeechPlayback } from "../io/speech-playback";
import type { TtsSynth } from "../io/tts-synth";
import { createBackendCaller } from "./backend-caller";
import {
  CONFIG,
  completedEvent,
  createScriptedStream,
  deltaEvent,
  expressEvent,
  makeLogger,
  turnOf,
  userEnv,
} from "./test-helpers";
import type { TurnOutput } from "./turn-output";

/** A synth whose resolve the test controls, and which records each input in call order. */
function deferredSynth() {
  const resolvers: Array<(b: ArrayBuffer) => void> = [];
  const calls: string[] = [];
  const synth: TtsSynth = (input) =>
    new Promise<ArrayBuffer>((resolve) => {
      calls.push(input);
      resolvers.push(resolve);
    });
  return { synth, resolvers, calls };
}

/** A fake sink that records each played buffer and resolves play() immediately. */
function recordingSink() {
  const played: ArrayBuffer[] = [];
  const sink: AudioSink = {
    play: vi.fn(async (wav: ArrayBuffer) => {
      played.push(wav);
    }),
    stop: vi.fn(),
  };
  return { sink, played };
}

const script = createScriptedStream();

describe("TurnOutput — backend-caller → tts-pipeline ordering", () => {
  let order: string[];
  let speechPlayback: SpeechPlayback;
  let synthCalls: string[];
  let resolvers: Array<(b: ArrayBuffer) => void>;
  let played: ArrayBuffer[];
  let turnOutput: TurnOutput;

  beforeEach(() => {
    script.reset();
    order = [];

    const deferred = deferredSynth();
    synthCalls = deferred.calls;
    resolvers = deferred.resolvers;
    const recorder = recordingSink();
    played = recorder.played;

    speechPlayback = createSpeechPlayback({
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
      pipeline: { synth: deferred.synth, sink: recorder.sink, maxInflight: () => 5 },
    });

    // Same literal shape voice-pipeline-wiring.ts builds — order-tracking wraps each member.
    turnOutput = {
      interrupt: () => {
        order.push("interrupt");
        speechPlayback.interrupt();
      },
      hasFiller: () => {
        order.push("hasFiller");
        return true;
      },
      thinkingStart: () => {
        order.push("thinkingStart");
      },
      thinkingEnd: () => {
        order.push("thinkingEnd");
      },
      delta: (text) => {
        order.push(`delta:${text}`);
        speechPlayback.onSpeechDelta(text);
      },
      speak: (text) => {
        order.push("speak");
        speechPlayback.onSpeech(text);
      },
      end: () => {
        order.push("end");
        speechPlayback.onSpeechEnd();
      },
      abort: () => {
        order.push("abort");
        speechPlayback.abort();
      },
      cue: (args) => {
        order.push(`cue:${args.emotion_text ?? args.emotion_id ?? args.motion_id ?? ""}`);
        speechPlayback.setCue(args);
      },
    };
  });

  it("streamed turn — interrupt precedes the first delta, the first delta ends thinking, end fires once and speak never does, sentences reach the synth in order", async () => {
    script.events = [
      deltaEvent("Hi. "),
      deltaEvent("there."),
      completedEvent({ speech_text: "Hi. there." }),
    ];
    const caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective: vi.fn() },
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      logger: makeLogger(),
    });

    const res = await caller.call(turnOf(userEnv()));
    expect(res).toBe("ok");

    expect(order.indexOf("interrupt")).toBe(0);
    expect(order.indexOf("interrupt")).toBeLessThan(order.indexOf("delta:Hi. "));
    // the first delta ends thinking: thinkingEnd precedes the first delta, and follows thinkingStart.
    expect(order.indexOf("thinkingStart")).toBeLessThan(order.indexOf("thinkingEnd"));
    expect(order.indexOf("thinkingEnd")).toBeLessThan(order.indexOf("delta:Hi. "));

    expect(order.filter((o) => o === "end")).toHaveLength(1);
    expect(order).not.toContain("speak");

    // resolve the deferred synth so playback can settle.
    for (const resolve of resolvers) resolve(new Uint8Array([1]).buffer);
    await vi.waitFor(() => expect(played.length).toBe(2));

    expect(synthCalls).toEqual(["Hi.", "there."]);
  });

  it("delta-less turn (completed only, non-empty speech_text) — speak fires, end does not", async () => {
    script.events = [completedEvent({ speech_text: "안녕." })];
    const caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective: vi.fn() },
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      logger: makeLogger(),
    });

    const res = await caller.call(turnOf(userEnv()));
    expect(res).toBe("ok");

    expect(order).toContain("speak");
    expect(order).not.toContain("end");
  });

  it("stream dies after a delta — abort fires, end does not", async () => {
    script.events = [deltaEvent("partial")];
    script.error = new Error("network reset");
    const caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective: vi.fn() },
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      logger: makeLogger(),
    });

    const res = await caller.call(turnOf(userEnv()));
    expect(res).not.toBe("ok");

    expect(order).toContain("abort");
    expect(order).not.toContain("end");
  });

  it("cue routing — a streamed express cue reaches cue() during streaming", async () => {
    script.events = [
      deltaEvent("hi "),
      expressEvent({ emotion_id: "happy", motion_id: "wave", emotion_text: "(whisper)" }),
      deltaEvent("there"),
      completedEvent({ speech_text: "hi there", emotion_text: "(whisper)" }),
    ];
    const caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective: vi.fn() },
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      logger: makeLogger(),
    });

    await caller.call(turnOf(userEnv()));

    expect(order.filter((o) => o.startsWith("cue:"))).toEqual(["cue:(whisper)"]);
    // routed strictly during the stream — before the end signal.
    expect(order.indexOf("cue:(whisper)")).toBeLessThan(order.indexOf("end"));
  });

  it("cue routing — on the completed-only path, cue() receives emotion_text alone", async () => {
    script.events = [completedEvent({ speech_text: "안녕", emotion_text: "(whisper)" })];
    const caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective: vi.fn() },
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      logger: makeLogger(),
    });

    await caller.call(turnOf(userEnv()));

    expect(order.filter((o) => o.startsWith("cue:"))).toEqual(["cue:(whisper)"]);
  });
});
