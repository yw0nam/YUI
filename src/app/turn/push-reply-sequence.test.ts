/**
 * push-reply-sequence.test.ts — what the client speaks after the user stops a reply.
 *
 * Runs over the real speech path: createSpeechPlayback on the real TTS pipeline, with only the
 * synth and the audio sink under the test's control. The two ways a user stops a reply — voice
 * barge-in and the stop button — each leave the pipeline able to speak the next reply the backend
 * starts on its own, while the renders still to come for the stopped turn are dropped.
 *
 * The same path carries a reply that lands while the turn's thinking bridge is still up: the
 * bridge holds the motion, so it has to come down before the render's cues are read.
 */

import { describe, expect, it, vi } from "vitest";
import type { ControlEnvelope, ExpressArgs } from "../../contract";
import { makeLogger } from "../../dispatcher/test-helpers";
import { createPushTurns } from "../../dispatcher/turn/push-turn";
import { createRenderTurn } from "../../dispatcher/turn/render-turn";
import type { TurnOutput } from "../../dispatcher/turn/turn-output";
import type { RenderFrame, SpeechFrame } from "../../io/chat/push-socket";
import type { AudioSink } from "../../io/voice/audio-player";
import { createSpeechPlayback } from "../../io/voice/speech-playback";
import type { TtsSynth } from "../../io/voice/tts-synth";

/** A synth the test releases one sentence at a time; the wav names its own index. */
function controlledSynth() {
  const inputs: string[] = [];
  const releases: Array<() => void> = [];
  const synth: TtsSynth = (input) => {
    const index = inputs.length;
    inputs.push(input);
    return new Promise<ArrayBuffer>((resolve) => {
      releases.push(() => resolve(new Uint8Array([index]).buffer));
    });
  };
  return { synth, inputs, deliver: (index: number) => releases[index]!() };
}

/** A sink that holds each buffer mid-playback until the pipeline is stopped, or the test lets it end. */
function heldSink(played: string[]) {
  const holds: Array<() => void> = [];
  const sink: AudioSink = {
    play: (wav) => {
      played.push(`play:${new Uint8Array(wav)[0]}`);
      return new Promise<void>((resolve) => holds.push(resolve));
    },
    stop: () => {
      for (const release of holds.splice(0)) release();
    },
  };
  return { sink, finish: () => holds.shift()?.() };
}

function frame(speech: string, turnId: string): RenderFrame {
  return { type: "render", turn_id: turnId, source: "hermes", segments: [{ speech }] };
}

/** Records the calls that decide which expression and motion the character is wearing. */
function recordingRenderer() {
  const directives: ControlEnvelope[] = [];
  const motions: Array<{ id: string } | null> = [];
  return {
    directives,
    motions,
    setMouthOpen: () => {},
    stopMouth: () => {},
    easeEmotionToNeutral: () => {},
    applyDirective: (envelope: ControlEnvelope) => {
      directives.push(envelope);
      if (envelope.motion) motions.push({ id: envelope.motion.id });
    },
    playMotion: (motion: { id: string } | null) => {
      motions.push(motion ? { id: motion.id } : null);
    },
  };
}

function setup() {
  const played: string[] = [];
  const synth = controlledSynth();
  const pushTurns = createPushTurns();
  const renderer = recordingRenderer();
  const sink = heldSink(played);
  const utterances: string[] = [];

  const speechPlayback = createSpeechPlayback({
    renderer,
    surfaces: {
      beginSpeech: () => {},
      pushSpeech: () => {},
      endSpeech: () => {},
      finishSpeech: () => {},
    },
    pipeline: { synth: synth.synth, sink: sink.sink, maxInflight: () => 5 },
    isStrolling: () => false,
    onUtteranceStart: () => utterances.push("start"),
    onUtteranceEnd: (ended) => utterances.push(ended),
  });

  const turnOutput: TurnOutput = {
    interrupt: () => speechPlayback.interrupt(),
    hasFiller: () => true,
    thinkingStart: () => {
      speechPlayback.holdMotion(true);
      renderer.playMotion({ id: "thinking" });
    },
    thinkingEnd: () => {
      if (!speechPlayback.holdMotion(false)) renderer.playMotion(null);
    },
    delta: (text) => speechPlayback.onSpeechDelta(text),
    speak: (text) => speechPlayback.onSpeech(text),
    end: () => speechPlayback.onSpeechEnd(),
    abort: () => speechPlayback.abort(),
    cue: (args) => speechPlayback.setCue(args),
    cueWithSpeech: (args) => speechPlayback.setCue(args, { withSpeech: true }),
    silentCue: (args) => speechPlayback.silentCue(args),
    toolStatus: () => {},
    activity: () => {},
    releaseMute: () => speechPlayback.releaseMute(),
    hasOutstandingSpeech: () => speechPlayback.hasOutstandingSpeech(),
    onQueueDrained: (callback) => speechPlayback.onQueueDrained(callback),
  };

  const renderTurn = createRenderTurn({ turnOutput, pushTurns, logger: makeLogger() });

  // The bridge the backend call holds: up at send, down once, whichever way the wait ends.
  let thinkingDone = false;
  const endThinking = (): void => {
    if (thinkingDone) return;
    thinkingDone = true;
    turnOutput.thinkingEnd(1);
  };

  // The stop closure bootstrap-configured hands to surfaces.onStop — the session reset runs the
  // same one: the outstanding turns are cut and the queued speech is stopped.
  const stopTurn = (): void => {
    pushTurns.cut();
    speechPlayback.interrupt();
  };

  return {
    played,
    synth,
    utterances,
    pushTurns,
    renderTurn,
    directives: renderer.directives,
    motions: renderer.motions,
    /** Lets the sentence playing now reach its end, so the next one starts. */
    finishPlayback: sink.finish,
    /** A filler line, spoken the way the thinking loop speaks one. */
    speakFiller: (text: string): void => speechPlayback.speakAside(text),
    /** A cue on its own, the way a streamed express cue arrives ahead of its speech. */
    cue: (args: ExpressArgs): void => turnOutput.cue(args),
    /** Sends a turn the way the backend call does, bridge and all, and waits for its end. */
    openTurn: (turnId: string): void => {
      pushTurns.opened(turnId);
      turnOutput.thinkingStart(1);
      // call()'s finally ends the bridge however the wait settles; onFirstRender is the render half.
      void pushTurns.awaitTurnEnd(turnId, { onFirstRender: endThinking }).then(endThinking);
    },
    stopButton: () => stopTurn(),
    // The pair wire-voice-pipeline performs when the user talks over the reply.
    bargeIn: () => {
      speechPlayback.interrupt({ muteCurrentTurn: true });
      pushTurns.cut();
    },
  };
}

describe("a reply the backend starts on its own, after the user stopped the last one", () => {
  it("is spoken after a barge-in, and the stopped turn's next render is dropped", async () => {
    const seq = setup();
    seq.pushTurns.opened("1");
    seq.renderTurn.render(frame("Let me look.", "1"));
    seq.synth.deliver(0);
    await vi.waitFor(() => expect(seq.played).toEqual(["play:0"]));

    seq.bargeIn();

    seq.renderTurn.render(frame("Three logs are left.", "1"));
    expect(seq.synth.inputs).toEqual(["Let me look."]);

    seq.renderTurn.render(frame("One more thing.", "hermes-1"));
    expect(seq.synth.inputs).toEqual(["Let me look.", "One more thing."]);
    seq.synth.deliver(1);
    await vi.waitFor(() => expect(seq.played).toEqual(["play:0", "play:1"]));
  });

  it("is spoken after the stop button, and the stopped turn's next render is dropped", async () => {
    const seq = setup();
    seq.pushTurns.opened("2");
    seq.renderTurn.render(frame("Long answer.", "2"));
    seq.synth.deliver(0);
    await vi.waitFor(() => expect(seq.played).toEqual(["play:0"]));

    seq.stopButton();

    seq.renderTurn.render(frame("And the rest.", "2"));
    expect(seq.synth.inputs).toEqual(["Long answer."]);

    seq.renderTurn.render(frame("One more thing.", "hermes-1"));
    expect(seq.synth.inputs).toEqual(["Long answer.", "One more thing."]);
    seq.synth.deliver(1);
    await vi.waitFor(() => expect(seq.played).toEqual(["play:0", "play:1"]));
  });
});

describe("a reply streamed as speech frames", () => {
  function speech(text: string, turnId: string): SpeechFrame {
    return { type: "speech", turn_id: turnId, segments: [{ speech: text }] };
  }

  it("speaks the first sentence before the turn's render and plays the reply as one utterance", async () => {
    const seq = setup();
    seq.openTurn("1");

    seq.renderTurn.stream(speech("All green.", "1"));

    expect(seq.synth.inputs).toEqual(["All green."]);
    expect(seq.motions.at(-1)).toBeNull();

    seq.synth.deliver(0);
    await vi.waitFor(() => expect(seq.played).toEqual(["play:0"]));
    seq.renderTurn.stream(speech("Every one.", "1"));
    seq.renderTurn.render(frame("Want the list?", "1"));

    expect(seq.synth.inputs).toEqual(["All green.", "Every one.", "Want the list?"]);

    seq.synth.deliver(1);
    seq.synth.deliver(2);
    seq.finishPlayback();
    await vi.waitFor(() => expect(seq.played).toEqual(["play:0", "play:1"]));
    seq.finishPlayback();
    await vi.waitFor(() => expect(seq.played).toEqual(["play:0", "play:1", "play:2"]));

    expect(seq.utterances).toEqual(["start"]);

    seq.finishPlayback();
    await vi.waitFor(() => expect(seq.utterances).toEqual(["start", "complete"]));
  });

  it("keeps the barge-in mute when the user talks over it, and drops the turn's later frames", async () => {
    const seq = setup();
    // The pairing wirePushTransport makes.
    seq.pushTurns.onCut((turnId) => seq.renderTurn.drop(turnId));
    seq.openTurn("1");
    seq.renderTurn.stream(speech("All green.", "1"));
    seq.synth.deliver(0);
    await vi.waitFor(() => expect(seq.played).toEqual(["play:0"]));

    seq.bargeIn();
    seq.renderTurn.stream(speech("Every one.", "1"));
    seq.renderTurn.render(frame("Want the list?", "1"));
    // A line spoken inside the mute window stays silent.
    seq.speakFiller("Hmm.");

    expect(seq.synth.inputs).toEqual(["All green."]);
    expect(seq.utterances).toEqual(["start", "interrupted"]);

    seq.renderTurn.render(frame("One more thing.", "hermes-1"));

    expect(seq.synth.inputs).toEqual(["All green.", "One more thing."]);
  });
});

describe("a reply that lands while the turn's thinking bridge is still up", () => {
  it("gives each segment its own cue", async () => {
    const seq = setup();
    seq.openTurn("1");

    seq.renderTurn.render({
      type: "render",
      turn_id: "1",
      source: "hermes",
      segments: [
        { cues: [{ emotion_id: "happy", emotion_text: "\u{1F606}" }], speech: "All green." },
        { cues: [{ emotion_id: "curious", emotion_text: "\u{1F442}" }], speech: "Want the list?" },
      ],
    });

    expect(seq.synth.inputs).toEqual(["\u{1F606} All green.", "\u{1F442} Want the list?"]);

    seq.synth.deliver(0);
    await vi.waitFor(() => expect(seq.played).toEqual(["play:0"]));

    expect(seq.directives).toEqual([{ speech_text: "", emotion: { id: "happy" } }]);
  });

  it("keeps a cue-only render's motion", async () => {
    const seq = setup();
    seq.openTurn("1");

    seq.renderTurn.render({
      type: "render",
      turn_id: "1",
      source: "hermes",
      segments: [{ cues: [{ motion_id: "happy" }], speech: "" }],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(seq.motions.at(-1)).toEqual({ id: "happy" });
  });
});

describe("a reply that lands while a filler line is playing", () => {
  it("plays after the filler, and still gives each segment its own cue", async () => {
    const seq = setup();
    seq.openTurn("1");
    seq.speakFiller("Let me check.");
    seq.synth.deliver(0);
    await vi.waitFor(() => expect(seq.played).toEqual(["play:0"]));

    seq.renderTurn.render({
      type: "render",
      turn_id: "1",
      source: "hermes",
      segments: [
        { cues: [{ emotion_id: "happy", emotion_text: "\u{1F606}" }], speech: "All green." },
        { cues: [{ emotion_id: "curious", emotion_text: "\u{1F442}" }], speech: "Want the list?" },
      ],
    });

    expect(seq.synth.inputs).toEqual([
      "Let me check.",
      "\u{1F606} All green.",
      "\u{1F442} Want the list?",
    ]);
    expect(seq.played).toEqual(["play:0"]);

    seq.synth.deliver(1);
    seq.synth.deliver(2);
    seq.finishPlayback();
    await vi.waitFor(() => expect(seq.played).toEqual(["play:0", "play:1"]));

    expect(seq.directives).toEqual([{ speech_text: "", emotion: { id: "happy" } }]);

    seq.finishPlayback();
    await vi.waitFor(() => expect(seq.played).toEqual(["play:0", "play:1", "play:2"]));

    expect(seq.directives).toEqual([
      { speech_text: "", emotion: { id: "happy" } },
      { speech_text: "", emotion: { id: "curious" } },
    ]);
  });
});

describe("a reply for another turn, arriving while a bridge is up", () => {
  const REPLY = [
    { cues: [{ emotion_id: "happy", emotion_text: "\u{1F606}" }], speech: "All green." },
    { cues: [{ emotion_id: "curious", emotion_text: "\u{1F442}" }], speech: "Want the list?" },
  ];

  it.each([
    ["another turn's", "B"],
    ["one the backend started on its own", "hermes-1"],
  ])("gives each segment of %s reply its own cue", async (_label, turnId) => {
    const seq = setup();
    seq.openTurn("A");

    seq.renderTurn.render({ type: "render", turn_id: turnId, source: "hermes", segments: REPLY });

    expect(seq.synth.inputs).toEqual(["\u{1F606} All green.", "\u{1F442} Want the list?"]);

    seq.synth.deliver(0);
    await vi.waitFor(() => expect(seq.played).toEqual(["play:0"]));

    expect(seq.directives).toEqual([{ speech_text: "", emotion: { id: "happy" } }]);
  });

  it("leaves no cue of that reply waiting for the bridge to come down", () => {
    const seq = setup();
    seq.openTurn("A");
    seq.renderTurn.render({ type: "render", turn_id: "B", source: "hermes", segments: REPLY });

    // A's own reply ends its bridge; nothing of B's is parked to ride the next line out.
    seq.renderTurn.render({ type: "render", turn_id: "A", source: "hermes", segments: [] });
    seq.speakFiller("Still working.");

    expect(seq.synth.inputs.at(-1)).toBe("Still working.");
  });

  it("lands a cue-only reply's motion when the bridge it arrived under comes down", () => {
    const seq = setup();
    seq.openTurn("A");

    seq.renderTurn.render({
      type: "render",
      turn_id: "B",
      source: "hermes",
      segments: [{ cues: [{ motion_id: "wave" }] }],
    });

    expect(seq.motions.at(-1)).toEqual({ id: "thinking" });

    // A's own reply ends its bridge, which is where B's parked cue lands.
    seq.renderTurn.render({ type: "render", turn_id: "A", source: "hermes", segments: [] });

    expect(seq.motions.at(-1)).toEqual({ id: "wave" });
  });

  it("still keeps a filler line off a cue waiting for its own speech", () => {
    const seq = setup();
    seq.openTurn("A");
    seq.cue({ emotion_id: "happy", emotion_text: "\u{1F606}" });
    seq.speakFiller("Let me check.");

    expect(seq.synth.inputs).toEqual(["Let me check."]);
  });
});
