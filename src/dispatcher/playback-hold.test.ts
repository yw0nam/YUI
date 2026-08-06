/**
 * playback-hold.test.ts — regression: a pending non-user turn must not jump the queue
 * while a finished reply still owes audio (issue #512).
 *
 * Wires the REAL dispatcher + guardrails + speech-playback + tts-pipeline + backend-caller —
 * only the synth, the audio sink, and the chat stream are faked. Reproduces the
 * stream-done → first-audio-frame window where isSpeaking() used to read false, letting
 * startBackendCall's onSpeechInterrupt dispose the pipeline holding a finished-but-unplayed reply.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PeekConfig, TapConfig } from "../config/load";
import type { AudioSink } from "../io/audio-player";
import { createSpeechPlayback, type SpeechPlayback } from "../io/speech-playback";
import type { TtsSynth } from "../io/tts-synth";
import { createBackendCaller } from "./backend-caller";
import { createDispatcher, type Dispatcher } from "./dispatcher";
import { type BusEnvelope, createEventBus, type EventBus } from "./event-bus";
import { createGuardrails, type Guardrails, type GuardrailsConfig } from "./guardrails";
import {
  CONFIG,
  completedEvent,
  createScriptedStream,
  deltaEvent,
  makeLogger,
  userEnv,
} from "./test-helpers";

const NOW = 1_717_000_000_000;

/** Permissive guardrails — routing/hold behavior only, not gating (guardrails.test.ts owns that). */
function permissiveGuardrailsConfig(): GuardrailsConfig {
  return {
    dnd: { app_blocklist: [] },
    debounce_ms: {
      idle_watcher: 0,
      os_event_watcher: 0,
      backend_push_source: 0,
      user_input_source: 0,
    },
    rate_limit: {
      window_ms: 3_600_000,
      tier2_max: 1000,
      tier3_max: 1000,
      overall_max: 1000,
      cooldown_ms: 300_000,
    },
  };
}

const PEEK_CONFIG: PeekConfig = {
  side_out_frac: 0.28,
  side_in_frac: 0.23,
  inset_frac: 0.12,
  mirror_side: "right",
};

const TAP_CONFIG: TapConfig = {
  spam_count: 4,
  spam_window_ms: 3_000,
  region_radius_frac: 0.18,
  region_motions: { chest: "embarrassed", hips: "embarrassed" },
  bored_cue: { label: "bored poking", context: "The user is poking repeatedly." },
  touch_cue_cooldown_ms: 60_000,
  touch_emotion_hold_ms: 4_000,
};

/** A synth whose resolve/reject the test controls — models a slow TTS provider. */
function deferredSynth() {
  const resolvers: Array<{ resolve: (b: ArrayBuffer) => void; reject: (e: unknown) => void }> = [];
  const synth: TtsSynth = () =>
    new Promise<ArrayBuffer>((resolve, reject) => {
      resolvers.push({ resolve, reject });
    });
  return { synth, resolvers };
}

/** A fake sink that records each played buffer; play() stays pending until finish() is called. */
function recordingSink() {
  const played: ArrayBuffer[] = [];
  let finishCurrent: (() => void) | null = null;
  const sink: AudioSink = {
    play(wav) {
      played.push(wav);
      return new Promise<void>((resolve) => {
        finishCurrent = resolve;
      });
    },
    stop: vi.fn(),
  };
  return {
    sink,
    played,
    finish(): void {
      const f = finishCurrent;
      finishCurrent = null;
      f?.();
    },
  };
}

function proactiveEnv(): BusEnvelope {
  return {
    source: "os_event_watcher",
    event_name: "proactive.tap_bored",
    ts: NOW + 1,
    hint_tier: 2,
    dnd_override: false,
    payload: {},
  };
}

const script = createScriptedStream();

describe("dispatcher — turn admission across the amplitude flag (#512)", () => {
  let bus: EventBus;
  let guardrails: Guardrails;
  let speechPlayback: SpeechPlayback;
  let resolvers: ReturnType<typeof deferredSynth>["resolvers"];
  let played: ArrayBuffer[];
  let finishPlayback: () => void;
  let dispatcher: Dispatcher;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    script.reset();
    script.queue = [];

    bus = createEventBus();
    guardrails = createGuardrails(permissiveGuardrailsConfig(), { now: () => Date.now() });

    const deferred = deferredSynth();
    resolvers = deferred.resolvers;
    const recorder = recordingSink();
    played = recorder.played;
    finishPlayback = recorder.finish;

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
      pipeline: { synth: deferred.synth, sink: recorder.sink },
    });

    const backendCaller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective: vi.fn() },
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      onSpeechDelta: (text) => speechPlayback.onSpeechDelta(text),
      onSpeechEnd: () => speechPlayback.onSpeechEnd(),
      onSpeechInterrupt: () => speechPlayback.interrupt(),
      logger: makeLogger(),
    });

    dispatcher = createDispatcher({
      bus,
      renderer: {
        applyDirective: vi.fn(),
        setPerchTarget: vi.fn(),
        setPeekTarget: vi.fn(),
        setMotionMirror: vi.fn(),
        easeEmotionToNeutral: vi.fn(),
      },
      peekConfig: () => PEEK_CONFIG,
      tapConfig: () => TAP_CONFIG,
      backendCaller,
      guardrails,
      isSpeaking: () => speechPlayback.isSpeaking(),
      logger: makeLogger(),
    });
  });

  /** Runs the user turn to `completed` while its synth stays pending, then queues a proactive turn behind it. */
  async function holdProactiveBehindOutstandingAudio(): Promise<BusEnvelope> {
    script.queue!.push([deltaEvent("Hello."), completedEvent({ speech_text: "Hello." })]);

    dispatcher.start();
    bus.push(userEnv());
    await vi.advanceTimersByTimeAsync(20);
    // Stream reached completed → pipeline.end() queued a boundary, but synth hasn't resolved yet.
    expect(script.spy.mock.calls.length).toBe(1);
    expect(speechPlayback.isSpeaking()).toBe(true);
    // The window this test guards: stream done, audio owed, but no frame has played yet —
    // this is precisely why the old amplitude flag read false.
    expect(played).toHaveLength(0);

    const proactive = proactiveEnv();
    bus.push(proactive);
    await vi.advanceTimersByTimeAsync(20);
    return proactive;
  }

  it("holds a pending non-user turn while a finished reply still owes audio", async () => {
    const proactive = await holdProactiveBehindOutstandingAudio();

    // The proactive turn must be held, not admitted — no second stream call yet.
    expect(script.spy.mock.calls.length).toBe(1);
    expect(dispatcher.inFlight()).toBeNull();
    expect(dispatcher.queue()).toContainEqual(
      expect.objectContaining({ event_name: "proactive.tap_bored" }),
    );
    expect(dispatcher.recentDrops(10).map((d) => d.event_name)).not.toContain(proactive.event_name);

    // Release the synth — the finished reply must actually reach playback, not be discarded.
    resolvers[0]!.resolve(new Uint8Array([7]).buffer);
    await vi.advanceTimersByTimeAsync(20);
    expect(played).toHaveLength(1);
  });

  it("drains the held turn once playback ends", async () => {
    await holdProactiveBehindOutstandingAudio();
    script.queue!.push([completedEvent({ speech_text: "" })]);

    resolvers[0]!.resolve(new Uint8Array([7]).buffer);
    await vi.advanceTimersByTimeAsync(20);
    expect(played).toHaveLength(1);

    finishPlayback();
    await vi.advanceTimersByTimeAsync(20);

    expect(script.spy.mock.calls.length).toBe(2);
  });
});
