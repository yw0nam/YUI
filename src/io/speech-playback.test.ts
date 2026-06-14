/**
 * speech-playback.test.ts — TDD red: TTS playback ↔ renderer mouth ↔ speech bubble glue.
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
import type { TtsPipeline, TtsPipelineOptions } from "./tts-pipeline";

/** Stub pipeline that captures the onAmplitude / onPlaybackEnd / onCuePlay it was constructed with. */
function stubPipelineFactory() {
  const calls = { pushTextDelta: [] as string[], ended: 0, disposed: 0 };
  let captured: TtsPipelineOptions | null = null;
  const factory = (opts: TtsPipelineOptions): TtsPipeline => {
    captured = opts;
    return {
      pushTextDelta: (t: string) => calls.pushTextDelta.push(t),
      setCue: () => {},
      end: () => {
        calls.ended++;
      },
      dispose: () => {
        calls.disposed++;
      },
    };
  };
  return {
    factory,
    calls,
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
    dispose: ReturnType<typeof vi.fn>;
    onAmplitude?: (rms: number) => void;
    onPlaybackEnd?: () => void;
  }> = [];
  const factory = (opts: TtsPipelineOptions): TtsPipeline => {
    const inst = {
      pushTextDelta: vi.fn(),
      setCue: vi.fn(),
      end: vi.fn(),
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
    createSpeechPlayback({ renderer, surfaces, createPipeline: stub.factory });

    stub.emitAmplitude(0.42);
    stub.emitAmplitude(0.8);
    expect(renderer.setMouthOpen).toHaveBeenNthCalledWith(1, 0.42);
    expect(renderer.setMouthOpen).toHaveBeenNthCalledWith(2, 0.8);
  });

  it("stops the mouth when playback ends", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    createSpeechPlayback({ renderer, surfaces, createPipeline: stub.factory });

    stub.emitPlaybackEnd();
    expect(renderer.stopMouth).toHaveBeenCalledTimes(1);
  });
});

describe("createSpeechPlayback — emotion eases back to neutral when playback ends", () => {
  it("eases the emotion to neutral with a slow duration on playback end", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    createSpeechPlayback({ renderer, surfaces, createPipeline: stub.factory });

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
    const sp = createSpeechPlayback({ renderer, surfaces, createPipeline: stub.factory });

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
    createSpeechPlayback({ renderer, surfaces, createPipeline: stub.factory });

    stub.emitPlaybackEnd();
    expect(renderer.stopMouth).toHaveBeenCalledTimes(1);
    expect(surfaces.finishSpeech).toHaveBeenCalledTimes(1);
    expect(renderer.easeEmotionToNeutral).toHaveBeenCalledTimes(1);
  });
});

describe("createSpeechPlayback — bubble defers until playback ends", () => {
  it("shows the bubble with a deferred dwell, then drives the pipeline", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const sp = createSpeechPlayback({ renderer, surfaces, createPipeline: stub.factory });

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
    const sp = createSpeechPlayback({ renderer, surfaces, createPipeline: stub.factory });

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
    const sp = createSpeechPlayback({ renderer, surfaces, createPipeline: stub.factory });

    sp.onSpeech("Text with no audio.");
    // pipeline still fires onPlaybackEnd after draining an empty/failed queue.
    stub.emitPlaybackEnd();
    expect(surfaces.finishSpeech).toHaveBeenCalledTimes(1);
  });
});

describe("createSpeechPlayback — dispose", () => {
  it("disposes the underlying pipeline", () => {
    const stub = stubPipelineFactory();
    const sp = createSpeechPlayback({
      renderer: spyRenderer(),
      surfaces: spySurfaces(),
      createPipeline: stub.factory,
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
    const sp = createSpeechPlayback({ renderer, surfaces, createPipeline: stub.factory });

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
    const sp = createSpeechPlayback({ renderer, surfaces, createPipeline: stub.factory });

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
    const sp = createSpeechPlayback({ renderer, surfaces, createPipeline: stub.factory });

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
    const sp = createSpeechPlayback({ renderer, surfaces, createPipeline: stub.factory });

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
    const sp = createSpeechPlayback({ renderer, surfaces, createPipeline: multi.factory });

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
    const sp = createSpeechPlayback({ renderer, surfaces, createPipeline: multi.factory });

    sp.setCue(null);
    expect(multi.instances[0].setCue).toHaveBeenCalledWith(null);
  });
});

describe("createSpeechPlayback — onCuePlay drives renderer directives", () => {
  it("onCuePlay with emotion_id+motion_id calls applyDirective with both mapped fields", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    createSpeechPlayback({ renderer, surfaces, createPipeline: stub.factory });

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
    createSpeechPlayback({ renderer, surfaces, createPipeline: stub.factory });

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
    createSpeechPlayback({ renderer, surfaces, createPipeline: stub.factory });

    stub.emitCuePlay({ emotion_text: "😆" });
    expect(renderer.applyDirective).not.toHaveBeenCalled();
    expect(renderer.easeEmotionToNeutral).toHaveBeenCalledWith(1000);
    expect(renderer.playMotion).toHaveBeenCalledWith(null);
  });

  it("onCuePlay(null) reverts to neutral: easeEmotionToNeutral(1000) + playMotion(null)", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    createSpeechPlayback({ renderer, surfaces, createPipeline: stub.factory });

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
    const sp = createSpeechPlayback({ renderer, surfaces, createPipeline: multi.factory });
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
    const sp = createSpeechPlayback({ renderer, surfaces, createPipeline: multi.factory });

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
    const sp = createSpeechPlayback({ renderer, surfaces, createPipeline: multi.factory });

    sp.onSpeechDelta("old");
    sp.interrupt();
    sp.onSpeechEnd();
    // the fresh pipeline never received an end (no delta since interrupt).
    expect(multi.instances[1].end).not.toHaveBeenCalled();
  });
});

describe("createSpeechPlayback — abort tears down without rebuilding", () => {
  it("disposes the current pipeline and releases the bubble (non-defer), no fresh pipeline", () => {
    const multi = multiPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const sp = createSpeechPlayback({ renderer, surfaces, createPipeline: multi.factory });
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
    const sp = createSpeechPlayback({ renderer, surfaces, createPipeline: stub.factory });

    sp.onSpeechDelta("partial");
    sp.abort();
    expect(surfaces.endSpeech).toHaveBeenCalledWith();
    expect(stub.calls.disposed).toBe(1);
  });
});

describe("createSpeechPlayback — onSpeech is sugar over delta+end", () => {
  it("begins, pushes text to bubble+pipeline, defers the bubble, and flushes once", () => {
    const stub = stubPipelineFactory();
    const renderer = spyRenderer();
    const surfaces = spySurfaces();
    const sp = createSpeechPlayback({ renderer, surfaces, createPipeline: stub.factory });

    sp.onSpeech("Whole thing.");
    expect(surfaces.beginSpeech).toHaveBeenCalledTimes(1);
    expect(surfaces.pushSpeech).toHaveBeenCalledWith("Whole thing.");
    expect(stub.calls.pushTextDelta).toEqual(["Whole thing."]);
    expect(surfaces.endSpeech).toHaveBeenCalledWith({ defer: true });
    expect(stub.calls.ended).toBe(1);
    expect(surfaces.finishSpeech).not.toHaveBeenCalled();
  });
});
