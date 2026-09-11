/**
 * speech-playback.test.ts — TTS playback ↔ renderer mouth ↔ speech bubble glue.
 *
 * Wires the three halves that already exist independently:
 *  - tts-pipeline onAmplitude → renderer.setMouthOpen (mouth follows TTS audio)
 *  - tts-pipeline onPlaybackEnd → renderer.stopMouth + surfaces.finishSpeech
 *  - onSpeech(text) → bubble (deferred dwell) + drive the pipeline
 *
 * Fakes everywhere: a stub pipeline that exposes the callbacks it was built with,
 * a spy renderer, and a spy surfaces. No real audio / DOM.
 */

import { describe, expect, it, vi } from "vitest";
import type { ExpressArgs } from "../contract";
import { createSpeechPlayback } from "./speech-playback";
import { TTS_SKIP, type TtsPipeline, type TtsPipelineOptions } from "./tts-pipeline";

/** These tests replace pipeline construction with a factory stub, so this synth is never called. */
const NO_PIPELINE = {
  synth: (): Promise<ArrayBuffer> => Promise.reject(new Error("synth unused in this test")),
};

/** Stub pipeline that captures the onAmplitude / onPlaybackEnd / onCuePlay it was constructed with. */
function stubPipelineFactory() {
  const calls = { pushTextDelta: [] as string[], ended: 0, disposed: 0 };
  let captured: TtsPipelineOptions | null = null;
  let outstanding = false;
  const factory = (opts: TtsPipelineOptions): TtsPipeline => {
    captured = opts;
    return {
      pushTextDelta: (t: string) => calls.pushTextDelta.push(t),
      setCue: () => {},
      end: () => {
        calls.ended++;
      },
      hasOutstandingWork: () => outstanding,
      dispose: () => {
        calls.disposed++;
        outstanding = false;
      },
    };
  };
  return {
    factory,
    calls,
    setOutstandingWork: (v: boolean) => {
      outstanding = v;
    },
    emitAmplitude: (v: number) => captured?.onAmplitude?.(v),
    emitPlaybackEnd: () => captured?.onPlaybackEnd?.(),
    emitCuePlay: (cue: ExpressArgs | null) => captured?.onCuePlay?.(cue),
  };
}

/**
 * Factory that returns a FRESH spy-pipeline each call, keeping every instance so
 * tests can assert which pipeline (first vs second after interrupt) received which call.
 */
function multiPipelineFactory() {
  const instances: Array<{
    pushTextDelta: ReturnType<typeof vi.fn>;
    setCue: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    hasOutstandingWork: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    onAmplitude?: (rms: number) => void;
    onPlaybackEnd?: () => void;
  }> = [];
  const factory = (opts: TtsPipelineOptions): TtsPipeline => {
    const inst = {
      pushTextDelta: vi.fn(),
      setCue: vi.fn(),
      end: vi.fn(),
      hasOutstandingWork: vi.fn(() => false),
      dispose: vi.fn(),
      onAmplitude: opts.onAmplitude,
      onPlaybackEnd: opts.onPlaybackEnd,
    };
    instances.push(inst);
    return inst as unknown as TtsPipeline;
  };
  return { factory, instances };
}

function spyRenderer() {
  return {
    setMouthOpen: vi.fn<(mouthOpen: number) => void>(),
    stopMouth: vi.fn<() => void>(),
    easeEmotionToNeutral: vi.fn<(durationMs: number) => void>(),
    applyDirective: vi.fn(),
    playMotion: vi.fn(),
  };
}

function spySurfaces() {
  return {
    beginSpeech: vi.fn(),
    pushSpeech: vi.fn(),
    endSpeech: vi.fn(),
    finishSpeech: vi.fn(),
  };
}

describe("createSpeechPlayback — amplitude drives the mouth", () => {
  it("forwards TTS amplitude to renderer.setMouthOpen during playback", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: stub.factory,
      isStrolling: () => false,
    });

    stub.emitAmplitude(0.42);
    stub.emitAmplitude(0.8);
    expect(renderer.setMouthOpen).toHaveBeenNthCalledWith(1, 0.42);
    expect(renderer.setMouthOpen).toHaveBeenNthCalledWith(2, 0.8);
  });

  it("stops the mouth when playback ends", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: stub.factory,
      isStrolling: () => false,
    });

    stub.emitPlaybackEnd();
    expect(renderer.stopMouth).toHaveBeenCalledTimes(1);
  });
});

describe("createSpeechPlayback — emotion eases back to neutral when playback ends", () => {
  it("eases the emotion to neutral with a slow duration on playback end", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: stub.factory,
      isStrolling: () => false,
    });

    expect(renderer.easeEmotionToNeutral).not.toHaveBeenCalled();
    stub.emitPlaybackEnd();
    expect(renderer.easeEmotionToNeutral).toHaveBeenCalledTimes(1);
    // a slow ease (>= 800ms), not the snappy default crossfade.
    const durationMs = renderer.easeEmotionToNeutral.mock.calls[0][0];
    expect(durationMs).toBeGreaterThanOrEqual(800);
  });

  it("eases to neutral even when no audio played (empty/disabled/failed turn)", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const sp = createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: stub.factory,
      isStrolling: () => false,
    });

    sp.onSpeech("Text with no audio.");
    // the emotion must NOT revert mid-utterance — only when playback ends.
    expect(renderer.easeEmotionToNeutral).not.toHaveBeenCalled();
    stub.emitPlaybackEnd();
    expect(renderer.easeEmotionToNeutral).toHaveBeenCalledTimes(1);
  });

  it("reverts alongside stopMouth + finishSpeech (same playback-end signal)", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: stub.factory,
      isStrolling: () => false,
    });

    stub.emitPlaybackEnd();
    expect(renderer.stopMouth).toHaveBeenCalledTimes(1);
    expect(surfaces.finishSpeech).toHaveBeenCalledTimes(1);
    expect(renderer.easeEmotionToNeutral).toHaveBeenCalledTimes(1);
  });
});

describe("createSpeechPlayback — emotion eases to neutral on abnormal end, not just natural playback end", () => {
  it("eases to neutral when abort() cuts off mid-speech", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const sp = createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: stub.factory,
      isStrolling: () => false,
    });

    sp.onSpeechDelta("Hello");
    stub.emitAmplitude(0.4);
    expect(renderer.easeEmotionToNeutral).not.toHaveBeenCalled();
    sp.abort();
    expect(renderer.easeEmotionToNeutral).toHaveBeenCalledTimes(1);
  });

  it("eases to neutral when interrupt() cuts off mid-speech (barge-in)", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const sp = createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: stub.factory,
      isStrolling: () => false,
    });

    sp.onSpeechDelta("Hello");
    stub.emitAmplitude(0.4);
    expect(renderer.easeEmotionToNeutral).not.toHaveBeenCalled();
    sp.interrupt();
    expect(renderer.easeEmotionToNeutral).toHaveBeenCalledTimes(1);
  });

  it("does not ease on interrupt() when nothing was speaking (routine pre-turn cleanup, no-op)", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const sp = createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: stub.factory,
      isStrolling: () => false,
    });

    sp.interrupt();
    expect(renderer.easeEmotionToNeutral).not.toHaveBeenCalled();
  });

  it("does not ease on interrupt() when audio was queued but never reached the speakers", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const sp = createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: stub.factory,
      isStrolling: () => false,
    });

    sp.onSpeechDelta("Hello");
    stub.setOutstandingWork(true);
    sp.interrupt();
    expect(renderer.easeEmotionToNeutral).not.toHaveBeenCalled();
  });
});

describe("createSpeechPlayback — bubble defers until playback ends", () => {
  it("shows the bubble with a deferred dwell, then drives the pipeline", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const sp = createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: stub.factory,
      isStrolling: () => false,
    });

    sp.onSpeech("Hello there.");
    expect(surfaces.beginSpeech).toHaveBeenCalledTimes(1);
    expect(surfaces.pushSpeech).toHaveBeenCalledWith("Hello there.");
    expect(surfaces.endSpeech).toHaveBeenCalledWith({ defer: true });
    // bubble must NOT be released yet — TTS hasn't finished.
    expect(surfaces.finishSpeech).not.toHaveBeenCalled();
    // pipeline driven with the text + flushed.
    expect(stub.calls.pushTextDelta).toEqual(["Hello there."]);
    expect(stub.calls.ended).toBe(1);
  });

  it("releases the bubble dwell only when playback completes", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const sp = createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: stub.factory,
      isStrolling: () => false,
    });

    sp.onSpeech("Spoken.");
    expect(surfaces.finishSpeech).not.toHaveBeenCalled();

    stub.emitPlaybackEnd();
    expect(surfaces.finishSpeech).toHaveBeenCalledTimes(1);
    expect(renderer.stopMouth).toHaveBeenCalledTimes(1);
  });

  it("releases the bubble even when no audio plays (empty/disabled/failed turn)", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const sp = createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: stub.factory,
      isStrolling: () => false,
    });

    sp.onSpeech("Text with no audio.");
    // pipeline still fires onPlaybackEnd after draining an empty/failed queue.
    stub.emitPlaybackEnd();
    expect(surfaces.finishSpeech).toHaveBeenCalledTimes(1);
  });
});

describe("createSpeechPlayback — reportAudioOwed (#279, #529)", () => {
  it("reports true after a delta submits a sentence", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const reportAudioOwed = vi.fn();
    const sp = createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: stub.factory,
      reportAudioOwed,
      isStrolling: () => false,
    });

    stub.setOutstandingWork(true);
    sp.onSpeechDelta("Hello");

    expect(reportAudioOwed).toHaveBeenCalledWith(true);
  });

  it("reports false after playback ends", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const reportAudioOwed = vi.fn();
    createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: stub.factory,
      reportAudioOwed,
      isStrolling: () => false,
    });

    stub.emitPlaybackEnd();

    expect(reportAudioOwed).toHaveBeenLastCalledWith(false);
  });

  it("reports false after interrupt()", () => {
    const multi = multiPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const reportAudioOwed = vi.fn();
    const sp = createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: multi.factory,
      reportAudioOwed,
      isStrolling: () => false,
    });

    multi.instances[0]!.hasOutstandingWork.mockReturnValue(true);
    sp.onSpeechDelta("Hello");
    expect(reportAudioOwed).toHaveBeenLastCalledWith(true);

    sp.interrupt();

    expect(reportAudioOwed).toHaveBeenLastCalledWith(false);
  });

  it("reports false after abort()", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const reportAudioOwed = vi.fn();
    const sp = createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: stub.factory,
      reportAudioOwed,
      isStrolling: () => false,
    });

    stub.setOutstandingWork(true);
    sp.onSpeechDelta("Hello");
    expect(reportAudioOwed).toHaveBeenLastCalledWith(true);

    sp.abort();
    expect(reportAudioOwed).toHaveBeenLastCalledWith(false);
  });
});

describe("createSpeechPlayback — dispose", () => {
  it("disposes the underlying pipeline", () => {
    const stub = stubPipelineFactory();
    const sp = createSpeechPlayback({
      renderer: spyRenderer(),
      surfaces: spySurfaces(),
      pipeline: NO_PIPELINE,
      createPipeline: stub.factory,
      isStrolling: () => false,
    });
    sp.dispose();
    expect(stub.calls.disposed).toBe(1);
  });
});

describe("createSpeechPlayback — onSpeechDelta streams text into bubble + pipeline", () => {
  it("first delta of a run begins the bubble exactly once; later deltas don't re-begin", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const sp = createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: stub.factory,
      isStrolling: () => false,
    });

    sp.onSpeechDelta("Hello");
    sp.onSpeechDelta(" there");
    sp.onSpeechDelta(".");
    // begin fires only on the first delta of the run.
    expect(surfaces.beginSpeech).toHaveBeenCalledTimes(1);
  });

  it("every delta pushes to the bubble AND the pipeline (in order)", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const sp = createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: stub.factory,
      isStrolling: () => false,
    });

    sp.onSpeechDelta("a");
    sp.onSpeechDelta("b");
    sp.onSpeechDelta("c");
    expect(surfaces.pushSpeech.mock.calls.map((c) => c[0])).toEqual(["a", "b", "c"]);
    expect(stub.calls.pushTextDelta).toEqual(["a", "b", "c"]);
    // streaming deltas must NOT flush/finish mid-run.
    expect(stub.calls.ended).toBe(0);
    expect(surfaces.finishSpeech).not.toHaveBeenCalled();
  });
});

describe("createSpeechPlayback — onSpeechEnd finalizes a run", () => {
  it("after ≥1 delta, defers the bubble dwell AND flushes the pipeline", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const sp = createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: stub.factory,
      isStrolling: () => false,
    });

    sp.onSpeechDelta("Hello.");
    sp.onSpeechEnd();
    expect(surfaces.endSpeech).toHaveBeenCalledWith({ defer: true });
    expect(stub.calls.ended).toBe(1);
    // bubble not released yet — TTS hasn't finished.
    expect(surfaces.finishSpeech).not.toHaveBeenCalled();
  });

  it("with no delta since begin → no-op (no endSpeech, no pipeline.end)", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const sp = createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: stub.factory,
      isStrolling: () => false,
    });

    sp.onSpeechEnd();
    expect(surfaces.endSpeech).not.toHaveBeenCalled();
    expect(stub.calls.ended).toBe(0);
    expect(surfaces.beginSpeech).not.toHaveBeenCalled();
  });
});

describe("createSpeechPlayback — setCue forwards to the pipeline", () => {
  it("forwards a cue to pipeline.setCue", () => {
    const multi = multiPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const sp = createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: multi.factory,
      isStrolling: () => false,
    });

    sp.setCue({ emotion_id: "happy", emotion_text: "😊" });
    expect(multi.instances[0].setCue).toHaveBeenCalledWith({
      emotion_id: "happy",
      emotion_text: "😊",
    });
  });

  it("forwards null to pipeline.setCue (clear)", () => {
    const multi = multiPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const sp = createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: multi.factory,
      isStrolling: () => false,
    });

    sp.setCue(null);
    expect(multi.instances[0].setCue).toHaveBeenCalledWith(null);
  });
});

describe("createSpeechPlayback — holdMotion buffers and flushes cues", () => {
  it("while held: setCue does NOT forward to pipeline.setCue", () => {
    const multi = multiPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const sp = createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: multi.factory,
      isStrolling: () => false,
    });

    sp.holdMotion(true);
    sp.setCue({ emotion_id: "calm", motion_id: "calm" });

    expect(multi.instances[0].setCue).not.toHaveBeenCalled();
  });

  it("while held: holdMotion(false) flushes the buffered cue to pipeline.setCue exactly once", () => {
    const multi = multiPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const sp = createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: multi.factory,
      isStrolling: () => false,
    });

    sp.holdMotion(true);
    sp.setCue({ emotion_id: "calm", motion_id: "calm" });
    sp.holdMotion(false);

    expect(multi.instances[0].setCue).toHaveBeenCalledTimes(1);
    expect(multi.instances[0].setCue).toHaveBeenCalledWith({
      emotion_id: "calm",
      motion_id: "calm",
    });
  });

  it("while held: multiple setCue calls — only the LATEST is flushed on release", () => {
    const multi = multiPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const sp = createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: multi.factory,
      isStrolling: () => false,
    });

    sp.holdMotion(true);
    sp.setCue({ emotion_id: "calm", motion_id: "calm" });
    sp.setCue({ emotion_id: "happy", motion_id: "dance" });
    sp.holdMotion(false);

    expect(multi.instances[0].setCue).toHaveBeenCalledTimes(1);
    expect(multi.instances[0].setCue).toHaveBeenCalledWith({
      emotion_id: "happy",
      motion_id: "dance",
    });
  });

  it("while held with NO setCue: holdMotion(false) does NOT call pipeline.setCue", () => {
    const multi = multiPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const sp = createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: multi.factory,
      isStrolling: () => false,
    });

    sp.holdMotion(true);
    sp.holdMotion(false);

    expect(multi.instances[0].setCue).not.toHaveBeenCalled();
  });

  it("holdMotion(true) again clears the previously buffered cue — subsequent release flushes nothing", () => {
    const multi = multiPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const sp = createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: multi.factory,
      isStrolling: () => false,
    });

    sp.holdMotion(true);
    sp.setCue({ emotion_id: "calm", motion_id: "calm" });
    // new thinking phase: hold again clears the stale buffer
    sp.holdMotion(true);
    sp.holdMotion(false);

    expect(multi.instances[0].setCue).not.toHaveBeenCalled();
  });

  it("not held (default): setCue forwards to pipeline.setCue immediately", () => {
    const multi = multiPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const sp = createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: multi.factory,
      isStrolling: () => false,
    });

    sp.setCue({ emotion_id: "happy" });

    expect(multi.instances[0].setCue).toHaveBeenCalledTimes(1);
    expect(multi.instances[0].setCue).toHaveBeenCalledWith({ emotion_id: "happy" });
  });
});

describe("createSpeechPlayback — onCuePlay drives renderer directives", () => {
  it("onCuePlay with emotion_id+motion_id calls applyDirective with both mapped fields", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: stub.factory,
      isStrolling: () => false,
    });

    stub.emitCuePlay({ emotion_id: "happy", motion_id: "dance" });
    expect(renderer.applyDirective).toHaveBeenCalledTimes(1);
    const env = renderer.applyDirective.mock.calls[0][0];
    expect(env).toMatchObject({
      emotion: { id: "happy" },
      motion: { id: "dance" },
      speech_text: "",
    });
    expect(renderer.easeEmotionToNeutral).not.toHaveBeenCalled();
    expect(renderer.playMotion).not.toHaveBeenCalled();
  });

  it("onCuePlay with emotion_id only (no motion_id) calls applyDirective with emotion but no motion key", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: stub.factory,
      isStrolling: () => false,
    });

    stub.emitCuePlay({ emotion_id: "curious" });
    expect(renderer.applyDirective).toHaveBeenCalledTimes(1);
    const env = renderer.applyDirective.mock.calls[0][0];
    expect(env).toMatchObject({ emotion: { id: "curious" }, speech_text: "" });
    expect(env.motion).toBeUndefined();
    expect(renderer.easeEmotionToNeutral).not.toHaveBeenCalled();
    expect(renderer.playMotion).not.toHaveBeenCalled();
  });

  it("onCuePlay with emotion_text only (no emotion_id/motion_id) reverts to neutral", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: stub.factory,
      isStrolling: () => false,
    });

    stub.emitCuePlay({ emotion_text: "😆" });
    expect(renderer.applyDirective).not.toHaveBeenCalled();
    expect(renderer.easeEmotionToNeutral).toHaveBeenCalledWith(1000);
    expect(renderer.playMotion).toHaveBeenCalledWith(null);
  });

  it("onCuePlay(null) reverts to neutral: easeEmotionToNeutral(1000) + playMotion(null)", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: stub.factory,
      isStrolling: () => false,
    });

    stub.emitCuePlay(null);
    expect(renderer.applyDirective).not.toHaveBeenCalled();
    expect(renderer.easeEmotionToNeutral).toHaveBeenCalledWith(1000);
    expect(renderer.playMotion).toHaveBeenCalledWith(null);
  });
});

describe("createSpeechPlayback — interrupt swaps the pipeline and releases the bubble", () => {
  it("disposes the current pipeline, builds a fresh one, and releases any visible bubble (non-defer)", () => {
    const multi = multiPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const sp = createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: multi.factory,
      isStrolling: () => false,
    });
    // factory called once at construction.
    expect(multi.instances.length).toBe(1);

    sp.interrupt();
    // current pipeline disposed.
    expect(multi.instances[0].dispose).toHaveBeenCalledTimes(1);
    // a FRESH pipeline was built.
    expect(multi.instances.length).toBe(2);
    // bubble released immediately (non-defer) to clear any stuck bubble.
    expect(surfaces.endSpeech).toHaveBeenCalledWith();
  });

  it("after interrupt, the next delta starts a new run and routes to the NEW pipeline", () => {
    const multi = multiPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const sp = createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: multi.factory,
      isStrolling: () => false,
    });

    sp.onSpeechDelta("old");
    sp.interrupt();
    sp.onSpeechDelta("new");

    // first instance only saw the pre-interrupt delta.
    expect(multi.instances[0].pushTextDelta.mock.calls.map((c) => c[0])).toEqual(["old"]);
    // post-interrupt delta routed to the fresh instance.
    expect(multi.instances[1].pushTextDelta.mock.calls.map((c) => c[0])).toEqual(["new"]);
    // beginSpeech fires again for the new run (twice total: pre + post interrupt).
    expect(surfaces.beginSpeech).toHaveBeenCalledTimes(2);
  });

  it("onSpeechEnd after interrupt with no new delta is a no-op (interrupt clears the run)", () => {
    const multi = multiPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const sp = createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: multi.factory,
      isStrolling: () => false,
    });

    sp.onSpeechDelta("old");
    sp.interrupt();
    sp.onSpeechEnd();
    // the fresh pipeline never received an end (no delta since interrupt).
    expect(multi.instances[1].end).not.toHaveBeenCalled();
  });
});

describe("createSpeechPlayback — muted interrupted turn", () => {
  it("keeps late text in the bubble without sending it to TTS", () => {
    const multi = multiPipelineFactory();
    const surfaces = spySurfaces();
    const sp = createSpeechPlayback({
      renderer: spyRenderer(),
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: multi.factory,
      isStrolling: () => false,
    });

    sp.interrupt({ muteCurrentTurn: true });
    sp.onSpeechDelta("late");

    expect(surfaces.pushSpeech).toHaveBeenCalledWith("late");
    expect(multi.instances[1].pushTextDelta).not.toHaveBeenCalled();
  });

  it("ends the deferred bubble and empty pipeline for a muted turn", () => {
    const multi = multiPipelineFactory();
    const surfaces = spySurfaces();
    const sp = createSpeechPlayback({
      renderer: spyRenderer(),
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: multi.factory,
      isStrolling: () => false,
    });

    sp.interrupt({ muteCurrentTurn: true });
    sp.onSpeechDelta("late");
    sp.onSpeechEnd();

    expect(surfaces.endSpeech).toHaveBeenCalledWith({ defer: true });
    expect(multi.instances[1].end).toHaveBeenCalledTimes(1);
  });

  it("clears mute when the next turn starts with a plain interrupt", () => {
    const multi = multiPipelineFactory();
    const sp = createSpeechPlayback({
      renderer: spyRenderer(),
      surfaces: spySurfaces(),
      pipeline: NO_PIPELINE,
      createPipeline: multi.factory,
      isStrolling: () => false,
    });

    sp.interrupt({ muteCurrentTurn: true });
    sp.interrupt();
    sp.onSpeechDelta("next");

    expect(multi.instances[2].pushTextDelta).toHaveBeenCalledWith("next");
  });

  it("clears mute when the interrupted turn completes", () => {
    const multi = multiPipelineFactory();
    const sp = createSpeechPlayback({
      renderer: spyRenderer(),
      surfaces: spySurfaces(),
      pipeline: NO_PIPELINE,
      createPipeline: multi.factory,
      isStrolling: () => false,
    });

    sp.interrupt({ muteCurrentTurn: true });
    sp.onSpeechDelta("late");
    sp.onSpeechEnd();
    sp.onSpeech("filler");

    expect(multi.instances[1].pushTextDelta).toHaveBeenCalledWith("filler");
  });

  it("drops cues while muted without leaking one into a later filler", () => {
    const multi = multiPipelineFactory();
    const sp = createSpeechPlayback({
      renderer: spyRenderer(),
      surfaces: spySurfaces(),
      pipeline: NO_PIPELINE,
      createPipeline: multi.factory,
      isStrolling: () => false,
    });

    sp.interrupt({ muteCurrentTurn: true });
    sp.holdMotion(true);
    sp.setCue({ emotion_id: "happy", motion_id: "dance" });
    sp.onSpeechDelta("late");
    sp.onSpeechEnd();
    sp.holdMotion(false);
    sp.onSpeech("filler");

    expect(multi.instances[1].setCue).not.toHaveBeenCalled();
    expect(multi.instances[1].pushTextDelta).toHaveBeenCalledWith("filler");
  });

  it("keeps delta routing unchanged after a plain interrupt", () => {
    const multi = multiPipelineFactory();
    const sp = createSpeechPlayback({
      renderer: spyRenderer(),
      surfaces: spySurfaces(),
      pipeline: NO_PIPELINE,
      createPipeline: multi.factory,
      isStrolling: () => false,
    });

    sp.interrupt();
    sp.onSpeechDelta("next");

    expect(multi.instances[1].pushTextDelta).toHaveBeenCalledWith("next");
  });

  it("clears mute when the interrupted turn completes without a delta", () => {
    const multi = multiPipelineFactory();
    const sp = createSpeechPlayback({
      renderer: spyRenderer(),
      surfaces: spySurfaces(),
      pipeline: NO_PIPELINE,
      createPipeline: multi.factory,
      isStrolling: () => false,
    });

    sp.interrupt({ muteCurrentTurn: true });
    sp.onSpeechEnd();
    sp.onSpeech("filler");

    expect(multi.instances[1].pushTextDelta).toHaveBeenCalledWith("filler");
  });
});

describe("createSpeechPlayback — abort tears down without rebuilding", () => {
  it("disposes the current pipeline and releases the bubble (non-defer), no fresh pipeline", () => {
    const multi = multiPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const sp = createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: multi.factory,
      isStrolling: () => false,
    });
    // factory called once at construction.
    expect(multi.instances.length).toBe(1);

    sp.abort();
    // current pipeline disposed.
    expect(multi.instances[0].dispose).toHaveBeenCalledTimes(1);
    // NO fresh pipeline (no new run is coming).
    expect(multi.instances.length).toBe(1);
    // bubble released immediately (non-defer) to clear the stuck bubble.
    expect(surfaces.endSpeech).toHaveBeenCalledWith();
  });

  it("releases the bubble dwell so a frozen bubble does not stay forever", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const sp = createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: stub.factory,
      isStrolling: () => false,
    });

    sp.onSpeechDelta("partial");
    sp.abort();
    expect(surfaces.endSpeech).toHaveBeenCalledWith();
    expect(stub.calls.disposed).toBe(1);
  });
});

describe("createSpeechPlayback — options.onPlaybackEnd passthrough", () => {
  it("invokes options.onPlaybackEnd when playback ends", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const onPlaybackEnd = vi.fn();
    createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: stub.factory,
      onPlaybackEnd,
      isStrolling: () => false,
    });

    stub.emitPlaybackEnd();
    expect(onPlaybackEnd).toHaveBeenCalledOnce();
  });

  it("options.onPlaybackEnd fires after stopMouth/finishSpeech/easeEmotionToNeutral", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const order: string[] = [];
    renderer.stopMouth.mockImplementation(() => order.push("stopMouth"));
    surfaces.finishSpeech.mockImplementation(() => order.push("finishSpeech"));
    renderer.easeEmotionToNeutral.mockImplementation(() => order.push("easeEmotion"));
    const onPlaybackEnd = vi.fn(() => order.push("onPlaybackEnd"));
    createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: stub.factory,
      onPlaybackEnd,
      isStrolling: () => false,
    });

    stub.emitPlaybackEnd();
    expect(order).toEqual(["stopMouth", "finishSpeech", "easeEmotion", "onPlaybackEnd"]);
  });

  it("works fine when options.onPlaybackEnd is not provided (no error)", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: stub.factory,
      isStrolling: () => false,
    });
    expect(() => stub.emitPlaybackEnd()).not.toThrow();
  });
});

describe("createSpeechPlayback — onSpeech is sugar over delta+end", () => {
  it("begins, pushes text to bubble+pipeline, defers the bubble, and flushes once", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const sp = createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: stub.factory,
      isStrolling: () => false,
    });

    sp.onSpeech("Whole thing.");
    expect(surfaces.beginSpeech).toHaveBeenCalledTimes(1);
    expect(surfaces.pushSpeech).toHaveBeenCalledWith("Whole thing.");
    expect(stub.calls.pushTextDelta).toEqual(["Whole thing."]);
    expect(surfaces.endSpeech).toHaveBeenCalledWith({ defer: true });
    expect(stub.calls.ended).toBe(1);
    expect(surfaces.finishSpeech).not.toHaveBeenCalled();
  });
});

describe("createSpeechPlayback — emoji sanitization in delta", () => {
  it("delta with decorative emoji: both surfaces.pushSpeech and pipeline receive cleaned text", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const sp = createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: stub.factory,
      isStrolling: () => false,
    });

    // trailing emoji is held in carry and discarded when the run ends (flush on onSpeechEnd).
    sp.onSpeechDelta("잘 왔어 ✨");
    // the stripper holds back trailing emoji-class run, so both sinks see the clean prefix.
    expect(surfaces.pushSpeech).toHaveBeenCalledWith("잘 왔어 ");
    expect(stub.calls.pushTextDelta).toEqual(["잘 왔어 "]);
  });

  it("clean delta (no emoji): both sinks receive text unchanged", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const sp = createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: stub.factory,
      isStrolling: () => false,
    });

    sp.onSpeechDelta("hello world");
    expect(surfaces.pushSpeech).toHaveBeenCalledWith("hello world");
    expect(stub.calls.pushTextDelta).toEqual(["hello world"]);
  });
});

describe("createSpeechPlayback — holdMotion suppresses playMotion(null) for null cues", () => {
  it("holdMotion(true): null-cue onCuePlay does NOT call playMotion(null) but DOES easeEmotionToNeutral", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const sp = createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: stub.factory,
      isStrolling: () => false,
    });

    sp.holdMotion(true);
    stub.emitCuePlay(null);

    expect(renderer.easeEmotionToNeutral).toHaveBeenCalledWith(1000);
    expect(renderer.playMotion).not.toHaveBeenCalled();
  });

  it("holdMotion(false) (default): null-cue onCuePlay still calls playMotion(null)", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: stub.factory,
      isStrolling: () => false,
    });

    // default is false — no holdMotion call needed
    stub.emitCuePlay(null);

    expect(renderer.easeEmotionToNeutral).toHaveBeenCalledWith(1000);
    expect(renderer.playMotion).toHaveBeenCalledWith(null);
  });

  it("a cue-less cue during a stroll leaves the walk clip alone", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: stub.factory,
      isStrolling: () => true,
    });

    stub.emitCuePlay(null);

    expect(renderer.easeEmotionToNeutral).toHaveBeenCalledWith(1000);
    expect(renderer.playMotion).not.toHaveBeenCalled();
  });

  it("a cue with a motion during a stroll still plays it", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: stub.factory,
      isStrolling: () => true,
    });

    stub.emitCuePlay({ emotion_id: "happy", motion_id: "happy" });

    expect(renderer.applyDirective).toHaveBeenCalledWith({
      speech_text: "",
      emotion: { id: "happy" },
      motion: { id: "happy" },
    });
  });

  it("real cue (emotion_id) still calls applyDirective regardless of holdMotion(true)", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const sp = createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: stub.factory,
      isStrolling: () => false,
    });

    sp.holdMotion(true);
    stub.emitCuePlay({ emotion_id: "happy", motion_id: "wave" });

    expect(renderer.applyDirective).toHaveBeenCalledTimes(1);
    expect(renderer.playMotion).not.toHaveBeenCalled();
  });
});

describe("createSpeechPlayback — stripper carry reset on interrupt/abort", () => {
  it("interrupt resets carry: stale trailing emoji does not leak into the next turn", () => {
    const multi = multiPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const sp = createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: multi.factory,
      isStrolling: () => false,
    });

    // push a delta ending in a trailing emoji-class run — stripper holds it in carry.
    sp.onSpeechDelta("hello ✨");
    // interrupt clears carry via stripper.reset().
    sp.interrupt();
    // new turn: plain delta must arrive at the new pipeline with no stale emoji prepended.
    sp.onSpeechDelta("new turn");
    const newPipelineCalls = multi.instances[1].pushTextDelta.mock.calls.map((c) => c[0]);
    expect(newPipelineCalls).toEqual(["new turn"]);
    // surfaces also receives only the clean new-turn text (no stale emoji prefix).
    const pushSpeeechNewTurnCall = surfaces.pushSpeech.mock.calls.find((c) => c[0] === "new turn");
    expect(pushSpeeechNewTurnCall).toBeDefined();
    const staleEmojiCall = surfaces.pushSpeech.mock.calls.find((c) =>
      (c[0] as string).includes("✨"),
    );
    expect(staleEmojiCall).toBeUndefined();
  });

  it("abort resets carry: stale trailing emoji does not leak into subsequent onSpeechDelta calls", () => {
    const multi = multiPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const sp = createSpeechPlayback({
      renderer,
      surfaces,
      pipeline: NO_PIPELINE,
      createPipeline: multi.factory,
      isStrolling: () => false,
    });

    // push a delta ending in a trailing emoji-class run — stripper holds it in carry.
    sp.onSpeechDelta("bye ✨");
    // abort clears carry via stripper.reset(); no new pipeline is built.
    sp.abort();
    // after abort, a fresh run (new turn from outside) must not see stale carry.
    sp.onSpeechDelta("clean start");
    // only one pipeline instance (abort does not rebuild).
    const pipelineCalls = multi.instances[0].pushTextDelta.mock.calls.map((c) => c[0]);
    // first call was "bye " (trailing emoji held), last call is "clean start" with no emoji leak.
    expect(pipelineCalls[pipelineCalls.length - 1]).toBe("clean start");
    const staleEmojiCall = surfaces.pushSpeech.mock.calls.find((c) =>
      (c[0] as string).includes("✨"),
    );
    expect(staleEmojiCall).toBeUndefined();
  });
});

describe("createSpeechPlayback — backend utterance tracking", () => {
  /** Playback over a stub pipeline with both utterance callbacks spied. */
  function trackedPlayback() {
    const stub = stubPipelineFactory();
    const onUtteranceStart = vi.fn();
    const onUtteranceEnd = vi.fn<(ended: "complete" | "interrupted") => void>();
    const sp = createSpeechPlayback({
      renderer: spyRenderer(),
      surfaces: spySurfaces(),
      pipeline: NO_PIPELINE,
      createPipeline: stub.factory,
      isStrolling: () => false,
      onUtteranceStart,
      onUtteranceEnd,
    });
    return { sp, stub, onUtteranceStart, onUtteranceEnd };
  }

  it("the first backend delta opens the utterance once; a second delta does not reopen it", () => {
    const { sp, onUtteranceStart } = trackedPlayback();

    sp.onSpeechDelta("hel");
    expect(onUtteranceStart).toHaveBeenCalledTimes(1);

    sp.onSpeechDelta("lo");
    expect(onUtteranceStart).toHaveBeenCalledTimes(1);
  });

  it("a played-out utterance ends complete when its boundary fires", () => {
    const { sp, stub, onUtteranceEnd } = trackedPlayback();

    sp.onSpeechDelta("hello");
    sp.onSpeechEnd();
    expect(onUtteranceEnd).not.toHaveBeenCalled();

    stub.emitPlaybackEnd();
    expect(onUtteranceEnd).toHaveBeenCalledTimes(1);
    expect(onUtteranceEnd).toHaveBeenCalledWith("complete");
  });

  it("interrupt mid-utterance ends it interrupted, and a second interrupt adds nothing", () => {
    const { sp, onUtteranceEnd } = trackedPlayback();

    sp.onSpeechDelta("hello");
    sp.interrupt();
    expect(onUtteranceEnd).toHaveBeenCalledTimes(1);
    expect(onUtteranceEnd).toHaveBeenCalledWith("interrupted");

    sp.interrupt();
    expect(onUtteranceEnd).toHaveBeenCalledTimes(1);
  });

  it("abort mid-utterance ends it interrupted", () => {
    const { sp, onUtteranceEnd } = trackedPlayback();

    sp.onSpeechDelta("hello");
    sp.abort();
    expect(onUtteranceEnd).toHaveBeenCalledTimes(1);
    expect(onUtteranceEnd).toHaveBeenCalledWith("interrupted");
  });

  it("interrupt before a queued boundary fires ends the utterance interrupted", () => {
    const { sp, onUtteranceEnd } = trackedPlayback();

    sp.onSpeechDelta("hello");
    sp.onSpeechEnd();
    sp.interrupt();

    expect(onUtteranceEnd).toHaveBeenCalledTimes(1);
    expect(onUtteranceEnd).toHaveBeenCalledWith("interrupted");
  });

  it("a barge-in interrupt ends the utterance and leaves the muted remainder untracked", () => {
    const { sp, stub, onUtteranceStart, onUtteranceEnd } = trackedPlayback();

    sp.onSpeechDelta("hello");
    sp.interrupt({ muteCurrentTurn: true });
    expect(onUtteranceEnd).toHaveBeenCalledTimes(1);
    expect(onUtteranceEnd).toHaveBeenCalledWith("interrupted");

    sp.onSpeechDelta("still arriving");
    expect(onUtteranceStart).toHaveBeenCalledTimes(1);

    sp.onSpeechEnd();
    stub.emitPlaybackEnd();
    expect(onUtteranceEnd).toHaveBeenCalledTimes(1);
  });

  it("speakAside is untracked and does not consume the backend utterance's boundary", () => {
    const { sp, stub, onUtteranceStart, onUtteranceEnd } = trackedPlayback();

    sp.speakAside("잠깐만");
    stub.emitPlaybackEnd();
    expect(onUtteranceStart).not.toHaveBeenCalled();
    expect(onUtteranceEnd).not.toHaveBeenCalled();

    sp.speakAside("조금만 더");
    sp.onSpeechDelta("답이야");
    sp.onSpeechEnd();
    expect(onUtteranceStart).toHaveBeenCalledTimes(1);

    stub.emitPlaybackEnd();
    expect(onUtteranceEnd).not.toHaveBeenCalled();

    stub.emitPlaybackEnd();
    expect(onUtteranceEnd).toHaveBeenCalledTimes(1);
    expect(onUtteranceEnd).toHaveBeenCalledWith("complete");
  });

  it("a routine pre-turn interrupt with nothing tracked reports nothing", () => {
    const { sp, onUtteranceStart, onUtteranceEnd } = trackedPlayback();

    sp.interrupt();

    expect(onUtteranceStart).not.toHaveBeenCalled();
    expect(onUtteranceEnd).not.toHaveBeenCalled();
  });

  it("abort behind an untracked boundary still ends the backend utterance once", () => {
    const { sp, onUtteranceEnd } = trackedPlayback();

    sp.speakAside("잠깐만");
    sp.onSpeechDelta("답이야");
    sp.onSpeechEnd();
    sp.abort();

    expect(onUtteranceEnd).toHaveBeenCalledTimes(1);
    expect(onUtteranceEnd).toHaveBeenCalledWith("interrupted");
  });

  it("a pipeline that fires its boundary inside end() still ends the utterance complete", () => {
    const onUtteranceEnd = vi.fn<(ended: "complete" | "interrupted") => void>();
    const sp = createSpeechPlayback({
      renderer: spyRenderer(),
      surfaces: spySurfaces(),
      pipeline: NO_PIPELINE,
      // What the real pipeline does when end() finds nothing submitted to play.
      createPipeline: (opts): TtsPipeline => ({
        pushTextDelta: () => {},
        setCue: () => {},
        end: () => opts.onPlaybackEnd?.(),
        hasOutstandingWork: () => false,
        dispose: () => {},
      }),
      isStrolling: () => false,
      onUtteranceEnd,
    });

    sp.onSpeechDelta("hello");
    sp.onSpeechEnd();

    expect(onUtteranceEnd).toHaveBeenCalledTimes(1);
    expect(onUtteranceEnd).toHaveBeenCalledWith("complete");
  });

  it("backend speech arriving after a barge-in reports start then interrupted, once", () => {
    const { sp, stub, onUtteranceStart, onUtteranceEnd } = trackedPlayback();

    // Barge-in landed while only the filler was speaking, before any backend delta.
    sp.interrupt({ muteCurrentTurn: true });
    sp.onSpeechDelta("the answer");

    expect(onUtteranceStart).toHaveBeenCalledTimes(1);
    expect(onUtteranceEnd).toHaveBeenCalledTimes(1);
    expect(onUtteranceEnd).toHaveBeenCalledWith("interrupted");

    sp.onSpeechDelta(" keeps arriving");
    sp.onSpeechEnd();
    stub.emitPlaybackEnd();

    expect(onUtteranceStart).toHaveBeenCalledTimes(1);
    expect(onUtteranceEnd).toHaveBeenCalledTimes(1);
  });

  it("a real pipeline whose synth skips still ends the utterance complete", async () => {
    const onUtteranceEnd = vi.fn<(ended: "complete" | "interrupted") => void>();
    const sp = createSpeechPlayback({
      renderer: spyRenderer(),
      surfaces: spySurfaces(),
      pipeline: {
        synth: () => Promise.reject(TTS_SKIP),
        sink: { play: async () => {}, stop: () => {} },
      },
      isStrolling: () => false,
      onUtteranceEnd,
    });

    sp.onSpeech("hi");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onUtteranceEnd).toHaveBeenCalledTimes(1);
    expect(onUtteranceEnd).toHaveBeenCalledWith("complete");
  });
});
