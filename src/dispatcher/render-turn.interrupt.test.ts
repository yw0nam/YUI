/**
 * render-turn.interrupt.test.ts — a silent segment's cue queued behind speech must not survive a
 * superseding render's interrupt.
 *
 * Wires createRenderTurn to a real createSpeechPlayback (a stub TTS pipeline stands in for
 * synth/playback), the same shape voice-pipeline-wiring.ts builds, so the interrupt path that
 * actually drops a stale onQueueDrained callback is under test — not a mock that could define its
 * own answer.
 */

import { describe, expect, it } from "vitest";
import type { ControlEnvelope } from "../contract";
import type { RenderFrame } from "../io/push-socket";
import { createSpeechPlayback } from "../io/speech-playback";
import type { TtsPipeline, TtsPipelineOptions } from "../io/tts-pipeline";
import { createRenderTurn } from "./render-turn";
import { makeLogger } from "./test-helpers";
import type { TurnOutput } from "./turn-output";

/** Captures every pipeline instance createSpeechPlayback builds — interrupt() rebuilds it, so a
 * test needs the CURRENT instance's boundary, not the one from before the interrupt. */
function capturingPipelineFactory() {
  const instances: Array<{ onPlaybackEnd?: () => void }> = [];
  const factory = (opts: TtsPipelineOptions): TtsPipeline => {
    instances.push({ onPlaybackEnd: opts.onPlaybackEnd });
    return {
      pushTextDelta: () => {},
      setCue: () => {},
      end: () => {},
      hasOutstandingWork: () => false,
      dispose: () => {},
    };
  };
  return {
    /** Fires the most recently built pipeline's playback-end boundary. */
    emitPlaybackEnd: () => instances[instances.length - 1]?.onPlaybackEnd?.(),
    factory,
  };
}

function frame(segments: RenderFrame["segments"], turnId: string): RenderFrame {
  return { type: "render", turn_id: turnId, source: "hermes", segments };
}

describe("render_turn — a superseding frame drops a pending silent cue", () => {
  it("frame B's interrupt clears frame A's silent cue before it can ever apply", () => {
    const directives: ControlEnvelope[] = [];
    const pipeline = capturingPipelineFactory();
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
      pipeline: { synth: () => Promise.reject(new Error("unused in this test")) },
      createPipeline: pipeline.factory,
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
      onQueueDrained: (callback) => speechPlayback.onQueueDrained(callback),
    };

    const renderTurn = createRenderTurn({
      turnOutput,
      renderer: { applyDirective: (env) => directives.push(env) },
      logger: makeLogger(),
    });

    // Frame A: speech ahead of a silent cue — the cue waits behind the queued speech.
    renderTurn.render(
      frame([{ speech: "Here." }, { cues: [{ emotion_id: "sad" }], speech: "[SILENT]" }], "a"),
    );

    // Frame B supersedes A before A's queued speech ever finishes playing.
    renderTurn.render(frame([{ speech: "Bye." }], "b"));

    // Frame B's own speech finishes playing.
    pipeline.emitPlaybackEnd();

    expect(directives).toEqual([]);
  });
});
