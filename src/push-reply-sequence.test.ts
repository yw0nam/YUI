/**
 * push-reply-sequence.test.ts — what the client speaks after the user stops a reply.
 *
 * Runs over the real speech path: createSpeechPlayback on the real TTS pipeline, with only the
 * synth and the audio sink under the test's control. The two ways a user stops a reply — voice
 * barge-in and the stop button — each leave the pipeline able to speak the next reply the backend
 * starts on its own, while the renders still to come for the stopped turn are dropped.
 */

import { describe, expect, it, vi } from "vitest";
import { wireStopControl } from "./bootstrap-wiring";
import { createPushTurns } from "./dispatcher/push-turn";
import { createRenderTurn } from "./dispatcher/render-turn";
import { makeLogger } from "./dispatcher/test-helpers";
import type { TurnOutput } from "./dispatcher/turn-output";
import type { AudioSink } from "./io/audio-player";
import type { RenderFrame } from "./io/push-socket";
import { createSpeechPlayback } from "./io/speech-playback";
import type { TtsSynth } from "./io/tts-synth";

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

/** A sink that holds each buffer mid-playback until the pipeline is stopped. */
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
  return sink;
}

function frame(speech: string, turnId: string | null): RenderFrame {
  return { type: "render", turn_id: turnId, source: "hermes", segments: [{ speech }] };
}

function setup() {
  const played: string[] = [];
  const synth = controlledSynth();
  const pushTurns = createPushTurns();

  const speechPlayback = createSpeechPlayback({
    renderer: {
      setMouthOpen: () => {},
      stopMouth: () => {},
      easeEmotionToNeutral: () => {},
      applyDirective: () => {},
      playMotion: () => {},
    },
    surfaces: {
      beginSpeech: () => {},
      pushSpeech: () => {},
      endSpeech: () => {},
      finishSpeech: () => {},
    },
    pipeline: { synth: synth.synth, sink: heldSink(played), maxInflight: () => 5 },
    isStrolling: () => false,
  });

  const turnOutput: TurnOutput = {
    interrupt: () => speechPlayback.interrupt(),
    hasFiller: () => false,
    thinkingStart: () => {},
    thinkingEnd: () => {},
    delta: (text) => speechPlayback.onSpeechDelta(text),
    speak: (text) => speechPlayback.onSpeech(text),
    end: () => speechPlayback.onSpeechEnd(),
    abort: () => speechPlayback.abort(),
    cue: (args) => speechPlayback.setCue(args),
    toolStatus: () => {},
    activity: () => {},
    releaseMute: () => speechPlayback.releaseMute(),
    hasOutstandingSpeech: () => speechPlayback.hasOutstandingSpeech(),
    onQueueDrained: (callback) => speechPlayback.onQueueDrained(callback),
  };

  const renderTurn = createRenderTurn({
    turnOutput,
    pushTurns,
    renderer: { applyDirective: () => {} },
    logger: makeLogger(),
  });

  let onStop = (): void => {};
  wireStopControl({
    onStop: (callback) => {
      onStop = callback;
    },
    cancel: () => {},
    stopSpeech: () => speechPlayback.interrupt(),
    cutPushTurns: () => pushTurns.cut(),
  });

  return {
    played,
    synth,
    pushTurns,
    renderTurn,
    stopButton: () => onStop(),
    // The pair voice-pipeline-wiring performs when the user talks over the reply.
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

    seq.renderTurn.render(frame("One more thing.", null));
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

    seq.renderTurn.render(frame("One more thing.", null));
    expect(seq.synth.inputs).toEqual(["Long answer.", "One more thing."]);
    seq.synth.deliver(1);
    await vi.waitFor(() => expect(seq.played).toEqual(["play:0", "play:1"]));
  });
});
