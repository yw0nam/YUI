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

import { describe, it, expect, vi } from "vitest";
import { createSpeechPlayback } from "./speech-playback";
import type { TtsPipeline, TtsPipelineOptions } from "./tts-pipeline";

/** Stub pipeline that captures the onAmplitude / onPlaybackEnd it was constructed with. */
function stubPipelineFactory() {
  const calls = { pushTextDelta: [] as string[], ended: 0, disposed: 0 };
  let captured: TtsPipelineOptions | null = null;
  const factory = (opts: TtsPipelineOptions): TtsPipeline => {
    captured = opts;
    return {
      pushTextDelta: (t: string) => calls.pushTextDelta.push(t),
      setEmotionText: () => {},
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
  };
}

function spyRenderer() {
  return { setMouthOpen: vi.fn(), stopMouth: vi.fn(), easeEmotionToNeutral: vi.fn() };
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
    const durationMs = renderer.easeEmotionToNeutral.mock.calls[0][0] as number;
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
