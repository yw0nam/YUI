/**
 * render-turn.cue-order.test.ts — when a silent segment's cue lands once frames queue up.
 *
 * Wires createRenderTurn to a real createSpeechPlayback over the real TTS pipeline — only the
 * synth and the audio sink are controlled — so the cue timing under test is the pipeline's own
 * playback boundary and not an answer a stub defines.
 *
 * A frame no longer interrupts the one before it, so a cue waiting on the queue survives the next
 * frame. The boundary that releases it is the pipeline's, not the frame's: every waiting cue fires
 * at the next boundary playback reaches, which for a frame still being synthesised is before its
 * own speech. That is the ordering this file pins down.
 */

import { describe, expect, it, vi } from "vitest";
import type { ControlEnvelope } from "../contract";
import type { RenderFrame } from "../io/chat/push-socket";
import type { AudioSink } from "../io/voice/audio-player";
import { createSpeechPlayback } from "../io/voice/speech-playback";
import type { TtsSynth } from "../io/voice/tts-synth";
import { createPushTurns } from "./push-turn";
import { createRenderTurn } from "./render-turn";
import { makeLogger } from "./test-helpers";
import type { TurnOutput } from "./turn-output";

/** A synth the test releases one sentence at a time, in whichever order it likes. */
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

function setup() {
  const order: string[] = [];
  const directives: ControlEnvelope[] = [];
  const synth = controlledSynth();
  const sink: AudioSink = {
    play: async (wav) => {
      order.push(`play:${new Uint8Array(wav)[0]}`);
    },
    stop: () => {},
  };

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
    // Both sentences reach the synth at once, so the test alone decides which is ready first.
    pipeline: { synth: synth.synth, sink, maxInflight: () => 5 },
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
    cueWithSpeech: (args) => speechPlayback.setCue(args, { withSpeech: true }),
    toolStatus: () => {},
    activity: () => {},
    releaseMute: () => speechPlayback.releaseMute(),
    hasOutstandingSpeech: () => speechPlayback.hasOutstandingSpeech(),
    onQueueDrained: (callback) => speechPlayback.onQueueDrained(callback),
  };

  const renderTurn = createRenderTurn({
    turnOutput,
    pushTurns: createPushTurns(),
    renderer: {
      applyDirective: (env) => {
        directives.push(env);
        order.push(`cue:${env.emotion?.id ?? env.motion?.id ?? ""}`);
      },
    },
    logger: makeLogger(),
  });

  return { order, directives, renderTurn, deliver: synth.deliver, inputs: synth.inputs };
}

function frame(segments: RenderFrame["segments"], turnId: string): RenderFrame {
  return { type: "render", turn_id: turnId, source: "hermes", segments };
}

describe("render_turn — a cue waiting behind queued speech", () => {
  it("fires both frames' trailing cues at the first boundary, so B's lands before B speaks", async () => {
    const { order, directives, renderTurn, deliver, inputs } = setup();

    renderTurn.render(
      frame([{ speech: "Here." }, { cues: [{ emotion_id: "sad" }], speech: "[SILENT]" }], "a"),
    );
    renderTurn.render(
      frame([{ speech: "Bye." }, { cues: [{ emotion_id: "happy" }], speech: "[SILENT]" }], "b"),
    );

    expect(inputs).toEqual(["Here.", "Bye."]);
    // Nothing applies while the queued speech still owes audio.
    expect(directives).toEqual([]);

    // A's sentence is ready first; B's is still being synthesised when A's boundary is reached.
    deliver(0);
    await vi.waitFor(() => expect(order).toContain("cue:happy"));

    expect(order).toEqual(["play:0", "cue:sad", "cue:happy"]);

    deliver(1);
    await vi.waitFor(() => expect(order).toContain("play:1"));
  });

  it("fires both trailing cues after both sentences when both are ready to play", async () => {
    const { order, directives, renderTurn, deliver } = setup();

    renderTurn.render(
      frame([{ speech: "Here." }, { cues: [{ emotion_id: "sad" }], speech: "[SILENT]" }], "a"),
    );
    renderTurn.render(
      frame([{ speech: "Bye." }, { cues: [{ emotion_id: "happy" }], speech: "[SILENT]" }], "b"),
    );

    // B's sentence is ready first, so playback runs straight through both before any boundary.
    deliver(1);
    deliver(0);
    await vi.waitFor(() => expect(order).toContain("cue:happy"));

    expect(order).toEqual(["play:0", "play:1", "cue:sad", "cue:happy"]);
    expect(directives).toEqual([
      { speech_text: "", emotion: { id: "sad" } },
      { speech_text: "", emotion: { id: "happy" } },
    ]);
  });

  it("makes a leading silent cue wait for the speech an earlier frame already queued", async () => {
    const { order, directives, renderTurn, deliver } = setup();

    renderTurn.render(frame([{ speech: "Here." }], "a"));
    renderTurn.render(
      frame([{ cues: [{ emotion_id: "happy" }], speech: "[SILENT]" }, { speech: "Bye." }], "b"),
    );

    expect(directives).toEqual([]);

    deliver(0);
    await vi.waitFor(() => expect(order).toContain("cue:happy"));

    expect(order).toEqual(["play:0", "cue:happy"]);
  });
});
