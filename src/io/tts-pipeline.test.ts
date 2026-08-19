/**
 * tts-pipeline.test.ts — orchestration: segment → synth (concurrent) → ordered playback.
 *
 * Core guarantees:
 *  - synths run concurrently, but playback stays strictly in submission-index order even when responses arrive out of order.
 *  - emotion_text is snapshotted at sentence-emit time and prepended as a prefix (verbatim free text, never invented).
 *  - a synth error skips that index without deadlocking the queue.
 *
 * Verified with a fake synth (controllable promise) + fake AudioSink (records playback order) — no real audio/network.
 */

import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../logger";
import type { AudioSink } from "./audio-player";
import { createTtsPipeline } from "./tts-pipeline";

/** A 1-byte ArrayBuffer identifiable by its index. */
function bufFor(n: number): ArrayBuffer {
  const b = new Uint8Array([n]);
  return b.buffer;
}
const bufId = (buf: ArrayBuffer): number => new Uint8Array(buf)[0];

/** A fake synth whose resolve/reject can be controlled at call time. */
function deferredSynth() {
  const resolvers: Array<{
    resolve: (b: ArrayBuffer) => void;
    reject: (e: unknown) => void;
    input: string;
  }> = [];
  const inputs: string[] = [];
  const signals: Array<AbortSignal | undefined> = [];
  const synthOpts: Array<{ caption?: string } | undefined> = [];
  let inFlight = 0;
  let maxConcurrent = 0;
  const synth = (
    input: string,
    signal?: AbortSignal,
    opts?: { caption?: string },
  ): Promise<ArrayBuffer> => {
    inputs.push(input);
    signals.push(signal);
    synthOpts.push(opts);
    inFlight++;
    if (inFlight > maxConcurrent) maxConcurrent = inFlight;
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const done = () => {
        inFlight--;
      };
      resolvers.push({
        resolve: (b) => {
          done();
          resolve(b);
        },
        reject: (e) => {
          done();
          reject(e);
        },
        input,
      });
    });
  };
  return { synth, resolvers, inputs, signals, synthOpts, peakConcurrency: () => maxConcurrent };
}

/** A fake sink that records playback order. play stays pending until finished externally. */
function recordingSink() {
  const playedOrder: number[] = [];
  let finishCurrent: (() => void) | null = null;
  const sink: AudioSink = {
    play(wav: ArrayBuffer) {
      playedOrder.push(bufId(wav));
      return new Promise<void>((resolve) => {
        finishCurrent = resolve;
      });
    },
    stop: vi.fn(),
  };
  const finish = () => {
    const f = finishCurrent;
    finishCurrent = null;
    f?.();
  };
  return { sink, playedOrder, finish, stopMock: sink.stop as ReturnType<typeof vi.fn> };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createTtsPipeline — ordered playback", () => {
  it("plays in submission index order even when synths resolve out of order (maxInflight: 3)", async () => {
    const { synth, resolvers } = deferredSynth();
    const { sink, playedOrder, finish } = recordingSink();
    const pipe = createTtsPipeline({ synth, sink, maxInflight: 3 });

    pipe.pushTextDelta("First. Second. Third.");
    await tick();
    expect(resolvers).toHaveLength(3);

    // Resolve in reverse order: 2, then 1, then 0.
    resolvers[2].resolve(bufFor(2));
    resolvers[1].resolve(bufFor(1));
    await tick();
    // index 0 hasn't arrived yet, so nothing should play.
    expect(playedOrder).toEqual([]);

    resolvers[0].resolve(bufFor(0));
    await tick();
    expect(playedOrder).toEqual([0]); // 0 is playing, waiting for it to finish
    finish();
    await tick();
    finish();
    await tick();
    finish();
    await tick();
    expect(playedOrder).toEqual([0, 1, 2]);
  });
});

describe("createTtsPipeline — synth concurrency cap", () => {
  it("default cap is 1: the 2nd synth does not start until the 1st resolves", async () => {
    const { synth, resolvers, peakConcurrency } = deferredSynth();
    const { sink } = recordingSink();
    const pipe = createTtsPipeline({ synth, sink });

    pipe.pushTextDelta("First. Second. Third.");
    await tick();
    // Only synth #1 is dispatched; #2/#3 wait in the queue.
    expect(resolvers).toHaveLength(1);
    expect(peakConcurrency()).toBe(1);

    // Resolving #1 frees the slot → #2 dispatches.
    resolvers[0].resolve(bufFor(0));
    await tick();
    expect(resolvers).toHaveLength(2);
    expect(peakConcurrency()).toBe(1);

    resolvers[1].resolve(bufFor(1));
    await tick();
    expect(resolvers).toHaveLength(3);
    expect(peakConcurrency()).toBe(1);
    resolvers[2].resolve(bufFor(2));
  });

  it("cap > 1 overlaps: maxInflight 3 fires all 3 synths before any resolves", async () => {
    const { synth, resolvers, peakConcurrency } = deferredSynth();
    const { sink } = recordingSink();
    const pipe = createTtsPipeline({ synth, sink, maxInflight: 3 });

    pipe.pushTextDelta("First. Second. Third.");
    await tick();
    expect(resolvers).toHaveLength(3);
    expect(peakConcurrency()).toBe(3);
    resolvers[0].resolve(bufFor(0));
    resolvers[1].resolve(bufFor(1));
    resolvers[2].resolve(bufFor(2));
  });

  it("cap 1: playback order equals submission order", async () => {
    const { synth, resolvers } = deferredSynth();
    const { sink, playedOrder, finish } = recordingSink();
    const pipe = createTtsPipeline({ synth, sink });

    pipe.pushTextDelta("First. Second. Third.");
    await tick();
    expect(resolvers).toHaveLength(1);

    // Drain serially: each resolve frees the next synth, each finish plays the next chunk.
    resolvers[0].resolve(bufFor(0));
    await tick();
    expect(playedOrder).toEqual([0]);
    finish();
    await tick();
    resolvers[1].resolve(bufFor(1));
    await tick();
    expect(playedOrder).toEqual([0, 1]);
    finish();
    await tick();
    resolvers[2].resolve(bufFor(2));
    await tick();
    expect(playedOrder).toEqual([0, 1, 2]);
    finish();
    await tick();
  });

  it("non-positive / fractional maxInflight is floored to a serial minimum of 1", async () => {
    const { synth, resolvers, peakConcurrency } = deferredSynth();
    const { sink } = recordingSink();
    const pipe = createTtsPipeline({ synth, sink, maxInflight: 0 });

    pipe.pushTextDelta("First. Second.");
    await tick();
    expect(resolvers).toHaveLength(1);
    expect(peakConcurrency()).toBe(1);
    resolvers[0].resolve(bufFor(0));
  });

  // Regression: a NaN cap (?? does not catch NaN) made `inFlight < NaN` always false →
  // no synth ever dispatched → pending sat forever → onPlaybackEnd never fired (silent hang).
  // This test never awaits the hang: dispatch must happen within a tick, else the length
  // assertion fails fast against the buggy impl.
  it("function-form maxInflight returning NaN falls back to serial cap 1 and does not hang", async () => {
    const { synth, resolvers, peakConcurrency } = deferredSynth();
    const { sink, finish } = recordingSink();
    const onPlaybackEnd = vi.fn();
    const pipe = createTtsPipeline({
      synth,
      sink,
      onPlaybackEnd,
      maxInflight: () => NaN,
    });

    pipe.pushTextDelta("First. Second.");
    pipe.end();
    await tick();
    // Buggy impl dispatches nothing here → this fails fast (no hang).
    expect(resolvers).toHaveLength(1);
    expect(peakConcurrency()).toBe(1);

    resolvers[0].resolve(bufFor(0));
    await tick();
    finish();
    await tick();
    expect(resolvers).toHaveLength(2);
    resolvers[1].resolve(bufFor(1));
    await tick();
    finish();
    await tick();
    expect(peakConcurrency()).toBe(1);
    expect(onPlaybackEnd).toHaveBeenCalledTimes(1);
  });

  it("number-form NaN maxInflight also falls back to serial cap 1", async () => {
    const { synth, resolvers, peakConcurrency } = deferredSynth();
    const { sink } = recordingSink();
    const pipe = createTtsPipeline({ synth, sink, maxInflight: NaN });

    pipe.pushTextDelta("First. Second.");
    await tick();
    expect(resolvers).toHaveLength(1);
    expect(peakConcurrency()).toBe(1);
    resolvers[0].resolve(bufFor(0));
  });

  // Math.floor(Infinity) is Infinity, which is not finite → guard clamps it to 1 (serial),
  // not an unbounded cap. Asserts the guard treats non-finite the same regardless of sign.
  it("function-form maxInflight returning Infinity clamps to serial cap 1", async () => {
    const { synth, resolvers, peakConcurrency } = deferredSynth();
    const { sink } = recordingSink();
    const pipe = createTtsPipeline({ synth, sink, maxInflight: () => Infinity });

    pipe.pushTextDelta("First. Second.");
    await tick();
    expect(resolvers).toHaveLength(1);
    expect(peakConcurrency()).toBe(1);
    resolvers[0].resolve(bufFor(0));
  });

  it("function-form maxInflight (() => 3) overlaps like the number 3", async () => {
    const { synth, resolvers, peakConcurrency } = deferredSynth();
    const { sink } = recordingSink();
    const pipe = createTtsPipeline({ synth, sink, maxInflight: () => 3 });

    pipe.pushTextDelta("First. Second. Third.");
    await tick();
    expect(resolvers).toHaveLength(3);
    expect(peakConcurrency()).toBe(3);
    resolvers[0].resolve(bufFor(0));
    resolvers[1].resolve(bufFor(1));
    resolvers[2].resolve(bufFor(2));
  });

  it("function-form maxInflight is resolved per drain — a later drain honors the new value", async () => {
    const { synth, resolvers, peakConcurrency } = deferredSynth();
    const { sink, finish } = recordingSink();
    let cap = 1;
    const pipe = createTtsPipeline({ synth, sink, maxInflight: () => cap });

    // First batch with cap 1: only one synth dispatches.
    pipe.pushTextDelta("One. Two.");
    await tick();
    expect(resolvers).toHaveLength(1);
    expect(peakConcurrency()).toBe(1);

    // Drain the first batch so a fresh drain runs against the new cap.
    resolvers[0].resolve(bufFor(0));
    await tick();
    expect(resolvers).toHaveLength(2); // freed slot dispatched the queued #2
    resolvers[1].resolve(bufFor(1));
    await tick();
    finish();
    await tick();
    finish();
    await tick();

    // Raise the cap, then submit a second batch — the new value is honored.
    cap = 3;
    pipe.pushTextDelta("Three. Four. Five.");
    await tick();
    expect(resolvers).toHaveLength(5); // 2 from batch one + 3 from batch two
    expect(peakConcurrency()).toBe(3);
    resolvers[2].resolve(bufFor(2));
    resolvers[3].resolve(bufFor(3));
    resolvers[4].resolve(bufFor(4));
  });
});

describe("createTtsPipeline — emotion_text voice tag baking", () => {
  it("prepends cue emotion_text to the sentence sent to synth", async () => {
    const { synth, inputs, resolvers } = deferredSynth();
    const { sink } = recordingSink();
    const pipe = createTtsPipeline({ synth, sink });

    pipe.setCue({ emotion_text: "[whisper]" });
    pipe.pushTextDelta("Can you hear me?");
    await tick();
    expect(inputs).toEqual(["[whisper] Can you hear me?"]);
    resolvers[0].resolve(bufFor(0));
  });

  it("sends plain text when no cue is set", async () => {
    const { synth, inputs } = deferredSynth();
    const { sink } = recordingSink();
    const pipe = createTtsPipeline({ synth, sink });

    pipe.pushTextDelta("Plain sentence.");
    await tick();
    expect(inputs).toEqual(["Plain sentence."]);
  });

  it("each sentence gets its own cue: different emotion_texts bake per-sentence (maxInflight: 3)", async () => {
    const { synth, inputs } = deferredSynth();
    const { sink } = recordingSink();
    const pipe = createTtsPipeline({ synth, sink, maxInflight: 3 });

    pipe.setCue({ emotion_text: "[happy]" });
    pipe.pushTextDelta("One. ");
    pipe.setCue({ emotion_text: "[sad]" });
    pipe.pushTextDelta("Two. ");
    await tick();
    expect(inputs).toEqual(["[happy] One.", "[sad] Two."]);
  });
});

describe("createTtsPipeline — caption voice direction", () => {
  it("passes a cue caption to the next sentence's synth as opts.caption", async () => {
    const { synth, inputs, synthOpts } = deferredSynth();
    const { sink } = recordingSink();
    const pipe = createTtsPipeline({ synth, sink });

    pipe.setCue({ caption: "落ち着いた低めの声で。" });
    pipe.pushTextDelta("Can you hear me?");
    await tick();

    // The caption travels out-of-band — the spoken input is untouched.
    expect(inputs).toEqual(["Can you hear me?"]);
    expect(synthOpts[0]?.caption).toBe("落ち着いた低めの声で。");
  });

  it("is one-shot: the sentence after the cue gets no caption", async () => {
    const { synth, synthOpts } = deferredSynth();
    const { sink } = recordingSink();
    const pipe = createTtsPipeline({ synth, sink, maxInflight: 3 });

    pipe.setCue({ caption: "落ち着いた低めの声で。" });
    pipe.pushTextDelta("One. ");
    pipe.pushTextDelta("Two. ");
    await tick();

    expect(synthOpts[0]?.caption).toBe("落ち着いた低めの声で。");
    expect(synthOpts[1]?.caption).toBeUndefined();
  });

  it("carries caption and emotion_text from one cue onto the same sentence", async () => {
    const { synth, inputs, synthOpts } = deferredSynth();
    const { sink } = recordingSink();
    const pipe = createTtsPipeline({ synth, sink });

    pipe.setCue({ emotion_text: "👂", caption: "囁くような小さな声で。" });
    pipe.pushTextDelta("Good night.");
    await tick();

    expect(inputs).toEqual(["👂 Good night."]);
    expect(synthOpts[0]?.caption).toBe("囁くような小さな声で。");
  });

  it("sends no caption when the cue carries none", async () => {
    const { synth, synthOpts } = deferredSynth();
    const { sink } = recordingSink();
    const pipe = createTtsPipeline({ synth, sink });

    pipe.setCue({ emotion_id: "happy" });
    pipe.pushTextDelta("Plain sentence.");
    await tick();

    expect(synthOpts[0]?.caption).toBeUndefined();
  });

  it("sends no caption at all when no cue is set", async () => {
    const { synth, synthOpts } = deferredSynth();
    const { sink } = recordingSink();
    const pipe = createTtsPipeline({ synth, sink });

    pipe.pushTextDelta("Plain sentence.");
    await tick();

    expect(synthOpts[0]?.caption).toBeUndefined();
  });

  // setCue drops a cue with nothing renderable in it; a caption alone is renderable.
  it("keeps a caption-only cue instead of discarding it as empty", async () => {
    const { synth, resolvers, synthOpts } = deferredSynth();
    const { sink, finish } = recordingSink();
    const cuePlays: Array<import("../contract").ExpressArgs | null> = [];
    const pipe = createTtsPipeline({ synth, sink, onCuePlay: (cue) => cuePlays.push(cue) });

    pipe.setCue({ caption: "落ち着いた低めの声で。" });
    pipe.pushTextDelta("Hello.");
    await tick();
    expect(synthOpts[0]?.caption).toBe("落ち着いた低めの声で。");

    resolvers[0].resolve(bufFor(0));
    await tick();
    expect(cuePlays[0]).toMatchObject({ caption: "落ち着いた低めの声で。" });
    finish();
    await tick();
  });

  it("drops a whitespace-only caption rather than sending it", async () => {
    const { synth, synthOpts } = deferredSynth();
    const { sink } = recordingSink();
    const pipe = createTtsPipeline({ synth, sink });

    pipe.setCue({ caption: "   " });
    pipe.pushTextDelta("Hello.");
    await tick();

    expect(synthOpts[0]?.caption).toBeUndefined();
  });
});

describe("createTtsPipeline — end() flush", () => {
  it("flushes the segmenter remainder as a final segment (maxInflight: 3)", async () => {
    const { synth, inputs } = deferredSynth();
    const { sink } = recordingSink();
    const pipe = createTtsPipeline({ synth, sink, maxInflight: 3 });

    pipe.pushTextDelta("Complete. trailing remainder");
    await tick();
    expect(inputs).toEqual(["Complete."]);
    pipe.end();
    await tick();
    expect(inputs).toEqual(["Complete.", "trailing remainder"]);
  });
});

describe("createTtsPipeline — error resilience", () => {
  it("a synth rejection on one index does not block later indices (maxInflight: 3)", async () => {
    const { synth, resolvers } = deferredSynth();
    const { sink, playedOrder, finish } = recordingSink();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const pipe = createTtsPipeline({ synth, sink, maxInflight: 3 });

    pipe.pushTextDelta("A. B. C.");
    await tick();

    resolvers[0].reject(new Error("synth boom"));
    resolvers[1].resolve(bufFor(1));
    resolvers[2].resolve(bufFor(2));
    await tick();
    // index 0 failed → skip, play from 1.
    expect(playedOrder).toEqual([1]);
    finish();
    await tick();
    expect(playedOrder).toEqual([1, 2]);
    finish();
    await tick();
    errSpy.mockRestore();
  });
});

describe("createTtsPipeline — empty input", () => {
  it("does not call synth for whitespace-only / empty input", async () => {
    const { synth, inputs } = deferredSynth();
    const { sink } = recordingSink();
    const pipe = createTtsPipeline({ synth, sink });
    pipe.pushTextDelta("   \n  ");
    pipe.end();
    await tick();
    expect(inputs).toEqual([]);
  });
});

describe("createTtsPipeline — onPlaybackEnd signal", () => {
  it("fires exactly once after end() and the last queued chunk finishes (maxInflight: 3)", async () => {
    const { synth, resolvers } = deferredSynth();
    const { sink, finish } = recordingSink();
    const onPlaybackEnd = vi.fn();
    const pipe = createTtsPipeline({ synth, sink, onPlaybackEnd, maxInflight: 3 });

    pipe.pushTextDelta("First. Second.");
    pipe.end();
    await tick();
    // synths resolved, chunks queued → still playing, not done yet.
    resolvers[0].resolve(bufFor(0));
    resolvers[1].resolve(bufFor(1));
    await tick();
    expect(onPlaybackEnd).not.toHaveBeenCalled();

    finish(); // chunk 0 done
    await tick();
    expect(onPlaybackEnd).not.toHaveBeenCalled(); // chunk 1 still playing

    finish(); // chunk 1 (last) done
    await tick();
    expect(onPlaybackEnd).toHaveBeenCalledTimes(1);
  });

  it("does not fire before end() even if the queue has momentarily drained", async () => {
    const { synth, resolvers } = deferredSynth();
    const { sink, finish } = recordingSink();
    const onPlaybackEnd = vi.fn();
    const pipe = createTtsPipeline({ synth, sink, onPlaybackEnd });

    pipe.pushTextDelta("Only one. ");
    await tick();
    resolvers[0].resolve(bufFor(0));
    await tick();
    finish(); // chunk 0 done, but end() not yet called — more may come.
    await tick();
    expect(onPlaybackEnd).not.toHaveBeenCalled();

    pipe.end();
    await tick();
    // end() with a fully-drained queue → completion fires now.
    expect(onPlaybackEnd).toHaveBeenCalledTimes(1);
  });

  it("fires for empty / whitespace-only input where no audio ever plays", async () => {
    const { synth } = deferredSynth();
    const { sink } = recordingSink();
    const onPlaybackEnd = vi.fn();
    const pipe = createTtsPipeline({ synth, sink, onPlaybackEnd });

    pipe.pushTextDelta("   \n  ");
    pipe.end();
    await tick();
    expect(onPlaybackEnd).toHaveBeenCalledTimes(1);
  });

  it("fires when every synth fails so no chunk plays (maxInflight: 3)", async () => {
    const { synth, resolvers } = deferredSynth();
    const { sink, playedOrder } = recordingSink();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onPlaybackEnd = vi.fn();
    const pipe = createTtsPipeline({ synth, sink, onPlaybackEnd, maxInflight: 3 });

    pipe.pushTextDelta("A. B.");
    pipe.end();
    await tick();
    resolvers[0].reject(new Error("boom 0"));
    resolvers[1].reject(new Error("boom 1"));
    await tick();
    expect(playedOrder).toEqual([]);
    expect(onPlaybackEnd).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });

  it("fires after a mix of failed and played chunks drains (maxInflight: 3)", async () => {
    const { synth, resolvers } = deferredSynth();
    const { sink, playedOrder, finish } = recordingSink();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onPlaybackEnd = vi.fn();
    const pipe = createTtsPipeline({ synth, sink, onPlaybackEnd, maxInflight: 3 });

    pipe.pushTextDelta("A. B. C.");
    pipe.end();
    await tick();
    resolvers[0].reject(new Error("boom 0"));
    resolvers[1].resolve(bufFor(1));
    resolvers[2].resolve(bufFor(2));
    await tick();
    expect(playedOrder).toEqual([1]);
    expect(onPlaybackEnd).not.toHaveBeenCalled();
    finish(); // chunk 1 done → chunk 2 plays
    await tick();
    expect(playedOrder).toEqual([1, 2]);
    expect(onPlaybackEnd).not.toHaveBeenCalled();
    finish(); // chunk 2 (last) done
    await tick();
    expect(onPlaybackEnd).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });

  it("fires turn N's onPlaybackEnd exactly once when turn N+1's first delta arrives while N's last chunk is still playing", async () => {
    const { synth, resolvers } = deferredSynth();
    const { sink, playedOrder, finish } = recordingSink();
    const onPlaybackEnd = vi.fn();
    const pipe = createTtsPipeline({ synth, sink, onPlaybackEnd });

    // Turn N: one sentence, end() called while its only chunk is still playing.
    pipe.pushTextDelta("First.");
    await tick();
    resolvers[0].resolve(bufFor(0));
    await tick();
    expect(playedOrder).toEqual([0]); // chunk 0 is playing now
    pipe.end();
    await tick();
    expect(onPlaybackEnd).not.toHaveBeenCalled();

    // Turn N+1's first delta arrives before turn N's chunk finishes playing.
    pipe.pushTextDelta("Second.");
    await tick();

    // Turn N's chunk finishes — its onPlaybackEnd must fire now, not be dropped.
    finish();
    await tick();
    expect(onPlaybackEnd).toHaveBeenCalledTimes(1);

    // Turn N+1 proceeds and completes its own cycle independently.
    expect(resolvers).toHaveLength(2);
    resolvers[1].resolve(bufFor(1));
    await tick();
    expect(playedOrder).toEqual([0, 1]);
    pipe.end();
    finish();
    await tick();
    expect(onPlaybackEnd).toHaveBeenCalledTimes(2);
  });
});

describe("createTtsPipeline — setCue / onCuePlay", () => {
  it("onCuePlay fires with the cue for each sentence in submission order", async () => {
    const { synth, resolvers } = deferredSynth();
    const { sink, finish } = recordingSink();
    const cuePlays: Array<import("../contract").ExpressArgs | null> = [];
    const pipe = createTtsPipeline({
      synth,
      sink,
      maxInflight: 3,
      onCuePlay: (cue) => cuePlays.push(cue),
    });

    pipe.setCue({ emotion_id: "happy", motion_id: "dance", emotion_text: "😆" });
    pipe.pushTextDelta("Hello.");
    pipe.setCue({ emotion_id: "curious", emotion_text: "🤔" });
    pipe.pushTextDelta("World.");
    await tick();
    expect(resolvers).toHaveLength(2);

    resolvers[0].resolve(bufFor(0));
    resolvers[1].resolve(bufFor(1));
    await tick();
    // index 0 starts playing — onCuePlay fires for happy cue
    expect(cuePlays).toHaveLength(1);
    expect(cuePlays[0]).toMatchObject({
      emotion_id: "happy",
      motion_id: "dance",
      emotion_text: "😆",
    });
    finish(); // finish index 0
    await tick();
    // index 1 starts playing — onCuePlay fires for curious cue
    expect(cuePlays).toHaveLength(2);
    expect(cuePlays[1]).toMatchObject({ emotion_id: "curious", emotion_text: "🤔" });
    finish();
    await tick();
  });

  it("onCuePlay fires null for a sentence submitted with no preceding setCue", async () => {
    const { synth, resolvers } = deferredSynth();
    const { sink, finish } = recordingSink();
    const cuePlays: Array<import("../contract").ExpressArgs | null> = [];
    const pipe = createTtsPipeline({
      synth,
      sink,
      onCuePlay: (cue) => cuePlays.push(cue),
    });

    pipe.pushTextDelta("No cue here.");
    await tick();
    resolvers[0].resolve(bufFor(0));
    await tick();
    expect(cuePlays).toHaveLength(1);
    expect(cuePlays[0]).toBeNull();
    finish();
    await tick();
  });

  it("cue is one-shot: a second sentence with no new setCue gets null", async () => {
    const { synth, resolvers } = deferredSynth();
    const { sink, finish } = recordingSink();
    const cuePlays: Array<import("../contract").ExpressArgs | null> = [];
    const pipe = createTtsPipeline({
      synth,
      sink,
      maxInflight: 2,
      onCuePlay: (cue) => cuePlays.push(cue),
    });

    pipe.setCue({ emotion_id: "happy", emotion_text: "😊" });
    pipe.pushTextDelta("First.");
    pipe.pushTextDelta(" Second.");
    await tick();
    expect(resolvers).toHaveLength(2);

    resolvers[0].resolve(bufFor(0));
    resolvers[1].resolve(bufFor(1));
    await tick();
    expect(cuePlays).toHaveLength(1);
    expect(cuePlays[0]).toMatchObject({ emotion_id: "happy" });
    finish();
    await tick();
    expect(cuePlays).toHaveLength(2);
    expect(cuePlays[1]).toBeNull(); // cue NOT reused
    finish();
    await tick();
  });

  it("synth input contains voice tag only for cued sentence; uncued sentence has no tag", async () => {
    const { synth, inputs, resolvers } = deferredSynth();
    const { sink } = recordingSink();
    const pipe = createTtsPipeline({ synth, sink, maxInflight: 2 });

    pipe.setCue({ emotion_text: "😆" });
    pipe.pushTextDelta("Cued.");
    pipe.pushTextDelta(" Uncued.");
    await tick();
    expect(inputs[0]).toBe("😆 Cued.");
    expect(inputs[1]).toBe("Uncued.");
    resolvers[0].resolve(bufFor(0));
    resolvers[1].resolve(bufFor(1));
  });

  it("failed synth still triggers onCuePlay for its index (failed-skip path)", async () => {
    const { synth, resolvers } = deferredSynth();
    const { sink, finish } = recordingSink();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const cuePlays: Array<import("../contract").ExpressArgs | null> = [];
    const pipe = createTtsPipeline({
      synth,
      sink,
      maxInflight: 2,
      onCuePlay: (cue) => cuePlays.push(cue),
    });

    pipe.setCue({ emotion_id: "happy", emotion_text: "😊" });
    pipe.pushTextDelta("Will fail.");
    pipe.pushTextDelta(" Will play.");
    await tick();

    resolvers[0].reject(new Error("synth boom"));
    resolvers[1].resolve(bufFor(1));
    await tick();
    // index 0 failed — onCuePlay fires for its cue; pump immediately continues to index 1
    // and fires onCuePlay for index 1 too (both fire before sink.play awaits).
    expect(cuePlays).toHaveLength(2);
    expect(cuePlays[0]).toMatchObject({ emotion_id: "happy" });
    expect(cuePlays[1]).toBeNull();
    finish();
    await tick();
    errSpy.mockRestore();
  });
});

describe("createTtsPipeline — dispose()", () => {
  it("stops the sink, aborts in-flight synths, and makes no further play calls (maxInflight: 3)", async () => {
    const { synth, resolvers, signals } = deferredSynth();
    const { sink, playedOrder, stopMock } = recordingSink();
    const pipe = createTtsPipeline({ synth, sink, maxInflight: 3 });

    pipe.pushTextDelta("One. Two.");
    await tick();
    expect(signals[0]).toBeInstanceOf(AbortSignal);

    pipe.dispose();
    expect(stopMock).toHaveBeenCalled();
    expect(signals[0]?.aborted).toBe(true);

    // synth results arriving late after dispose are not played.
    resolvers[0].resolve(bufFor(0));
    resolvers[1].resolve(bufFor(1));
    await tick();
    expect(playedOrder).toEqual([]);
  });
});

// ── #observability: structured logging via injectable logger seam ──────────────

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/**
 * Sink that calls onAmplitude with a fixed sequence of values then resolves.
 * Exposes a finish() so tests can resolve the play() promise manually.
 */
function amplitudeSink(amplitudeValues: number[]) {
  let finishCurrent: (() => void) | null = null;
  const playedOrder: number[] = [];
  const sink: AudioSink = {
    play(wav: ArrayBuffer, onAmplitude?: (v: number) => void) {
      playedOrder.push(bufId(wav));
      return new Promise<void>((resolve) => {
        finishCurrent = () => {
          resolve();
        };
        // Emit amplitude values synchronously before the promise resolves.
        for (const v of amplitudeValues) {
          onAmplitude?.(v);
        }
      });
    },
    stop: vi.fn(),
  };
  const finish = () => {
    const f = finishCurrent;
    finishCurrent = null;
    f?.();
  };
  return { sink, playedOrder, finish };
}

describe("createTtsPipeline — observability logging seam", () => {
  it("emits debug('synth', {index, chars}) when a sentence is submitted", async () => {
    const { synth, resolvers } = deferredSynth();
    const { sink } = recordingSink();
    const logger = makeLogger();
    const pipe = createTtsPipeline({ synth, sink, logger });

    pipe.pushTextDelta("Hello world.");
    await tick();

    expect(logger.debug).toHaveBeenCalledWith(
      "synth",
      expect.objectContaining({ index: 0, chars: expect.any(Number) }),
    );
    resolvers[0].resolve(bufFor(0));
  });

  it("emits debug('synth', {index, ok:true, bytes}) when synth resolves", async () => {
    const { synth, resolvers } = deferredSynth();
    const { sink } = recordingSink();
    const logger = makeLogger();
    const pipe = createTtsPipeline({ synth, sink, logger });

    pipe.pushTextDelta("Sentence one.");
    await tick();
    resolvers[0].resolve(bufFor(0));
    await tick();

    expect(logger.debug).toHaveBeenCalledWith(
      "synth",
      expect.objectContaining({ index: 0, ok: true, bytes: expect.any(Number) }),
    );
  });

  it("emits error('synth', {index, error}) when synth rejects", async () => {
    const { synth, resolvers } = deferredSynth();
    const { sink } = recordingSink();
    const logger = makeLogger();
    const pipe = createTtsPipeline({ synth, sink, logger });

    pipe.pushTextDelta("Will fail.");
    await tick();
    resolvers[0].reject(new Error("network error"));
    await tick();

    expect(logger.error).toHaveBeenCalledWith(
      "synth",
      expect.objectContaining({ index: 0, error: expect.any(String) }),
    );
  });

  it("does NOT emit error('synth') when synth rejects after dispose", async () => {
    const { synth, resolvers } = deferredSynth();
    const { sink } = recordingSink();
    const logger = makeLogger();
    const pipe = createTtsPipeline({ synth, sink, logger });

    pipe.pushTextDelta("Will be disposed.");
    await tick();
    pipe.dispose();
    resolvers[0].reject(new Error("aborted"));
    await tick();

    expect(logger.error).not.toHaveBeenCalledWith("synth", expect.anything());
  });

  it("emits debug('playback', {index, state:'start'}) before sink.play", async () => {
    const { synth, resolvers } = deferredSynth();
    const { sink, finish } = recordingSink();
    const logger = makeLogger();
    const pipe = createTtsPipeline({ synth, sink, logger });

    pipe.pushTextDelta("Play me.");
    await tick();
    resolvers[0].resolve(bufFor(0));
    await tick();

    expect(logger.debug).toHaveBeenCalledWith(
      "playback",
      expect.objectContaining({ index: 0, state: "start" }),
    );
    finish();
  });

  it("emits debug('playback', {index, state:'end', peak_mouth}) with max amplitude after play resolves", async () => {
    const { synth, resolvers } = deferredSynth();
    const logger = makeLogger();
    // sink calls onAmplitude with [0.1, 0.5, 0.2]; peak should be 0.5
    const { sink, finish } = amplitudeSink([0.1, 0.5, 0.2]);
    const pipe = createTtsPipeline({ synth, sink, logger });

    pipe.pushTextDelta("Amplitude test.");
    await tick();
    resolvers[0].resolve(bufFor(0));
    await tick();
    finish();
    await tick();

    expect(logger.debug).toHaveBeenCalledWith(
      "playback",
      expect.objectContaining({ index: 0, state: "end", peak_mouth: 0.5 }),
    );
  });

  it("peak_mouth is 0 when no amplitude values are emitted", async () => {
    const { synth, resolvers } = deferredSynth();
    const { sink, finish } = recordingSink();
    const logger = makeLogger();
    const pipe = createTtsPipeline({ synth, sink, logger });

    pipe.pushTextDelta("Silent clip.");
    await tick();
    resolvers[0].resolve(bufFor(0));
    await tick();
    finish();
    await tick();

    expect(logger.debug).toHaveBeenCalledWith(
      "playback",
      expect.objectContaining({ index: 0, state: "end", peak_mouth: 0 }),
    );
  });

  it("emits info('playback', {state:'complete', segments}) right before onPlaybackEnd fires", async () => {
    const { synth, resolvers } = deferredSynth();
    const { sink, finish } = recordingSink();
    const logger = makeLogger();
    const onPlaybackEnd = vi.fn();
    const pipe = createTtsPipeline({
      synth,
      sink,
      logger,
      onPlaybackEnd,
      maxInflight: 3,
    });

    pipe.pushTextDelta("First. Second.");
    pipe.end();
    await tick();
    resolvers[0].resolve(bufFor(0));
    resolvers[1].resolve(bufFor(1));
    await tick();
    finish();
    await tick();
    finish();
    await tick();

    // complete log must have been emitted before onPlaybackEnd
    expect(logger.info).toHaveBeenCalledWith(
      "playback",
      expect.objectContaining({ state: "complete", segments: expect.any(Number) }),
    );
    expect(onPlaybackEnd).toHaveBeenCalledTimes(1);
    // Order: info("playback", complete) fires strictly before onPlaybackEnd
    const infoOrder = (logger.info as ReturnType<typeof vi.fn>).mock.invocationCallOrder;
    const endOrder = (onPlaybackEnd as ReturnType<typeof vi.fn>).mock.invocationCallOrder;
    expect(infoOrder[infoOrder.length - 1]).toBeLessThan(endOrder[0]);
  });
});

// ── #tts-skip: when synth rejects with the TTS_SKIP sentinel, it's a clean skip with no error log ──

import { TTS_SKIP } from "./tts-pipeline";

describe("createTtsPipeline — TTS_SKIP sentinel (silent skip)", () => {
  it("a synth that rejects with TTS_SKIP fires onCuePlay, fires onPlaybackEnd, does NOT call logger.error", async () => {
    // skip synth: always rejects with TTS_SKIP.
    const skipSynth = (_input: string, _signal?: AbortSignal): Promise<ArrayBuffer> =>
      Promise.reject(TTS_SKIP);

    const { sink } = recordingSink();
    const logger = makeLogger();
    const onPlaybackEnd = vi.fn();
    const cuePlays: Array<import("../contract").ExpressArgs | null> = [];

    const pipe = createTtsPipeline({
      synth: skipSynth,
      sink,
      logger,
      onPlaybackEnd,
      onCuePlay: (cue) => cuePlays.push(cue),
    });

    pipe.setCue({ emotion_id: "happy", emotion_text: "😊" });
    pipe.pushTextDelta("Skip me.");
    pipe.end();
    await tick();

    // the cue still fires (the skip path must run onCuePlay).
    expect(cuePlays).toHaveLength(1);
    expect(cuePlays[0]).toMatchObject({ emotion_id: "happy" });

    // the completion signal fires too.
    expect(onPlaybackEnd).toHaveBeenCalledTimes(1);

    // no error log — TTS_SKIP is a silent skip.
    expect(logger.error).not.toHaveBeenCalledWith("synth", expect.anything());
  });

  it("skip does NOT call logger.error even when pipeline has a mix of skip + real synth (maxInflight:2)", async () => {
    let callCount = 0;
    const mixedSynth = (_input: string, _signal?: AbortSignal): Promise<ArrayBuffer> => {
      callCount++;
      // first call skips, second is real.
      if (callCount === 1) return Promise.reject(TTS_SKIP);
      return Promise.resolve(bufFor(1));
    };

    const { sink, playedOrder, finish } = recordingSink();
    const logger = makeLogger();
    const onPlaybackEnd = vi.fn();

    const pipe = createTtsPipeline({
      synth: mixedSynth,
      sink,
      logger,
      onPlaybackEnd,
      maxInflight: 2,
    });

    pipe.pushTextDelta("Skip. Play.");
    pipe.end();
    await tick();

    // index 0 (skip) doesn't play → only index 1 plays.
    expect(playedOrder).toEqual([1]);
    finish();
    await tick();

    expect(onPlaybackEnd).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalledWith("synth", expect.anything());
  });
});

describe("createTtsPipeline — hasOutstandingWork (audio still owed)", () => {
  it("stays true from end() until the last chunk finishes, including before the first audio frame", async () => {
    const { synth, resolvers } = deferredSynth();
    const { sink, playedOrder, finish } = recordingSink();
    const onPlaybackEnd = vi.fn();
    const pipe = createTtsPipeline({ synth, sink, onPlaybackEnd });

    expect(pipe.hasOutstandingWork()).toBe(false);

    pipe.pushTextDelta("Hello.");
    pipe.end();
    await tick();
    // Stream done, synth in flight — no audio frame has fired yet.
    expect(pipe.hasOutstandingWork()).toBe(true);

    resolvers[0].resolve(bufFor(0));
    await tick();
    expect(playedOrder).toEqual([0]);
    expect(pipe.hasOutstandingWork()).toBe(true);

    finish();
    await tick();
    expect(onPlaybackEnd).toHaveBeenCalledTimes(1);
    expect(pipe.hasOutstandingWork()).toBe(false);
  });

  it("is false for a turn that submits no sentence", () => {
    const { synth } = deferredSynth();
    const { sink } = recordingSink();
    const pipe = createTtsPipeline({ synth, sink });

    pipe.end();
    expect(pipe.hasOutstandingWork()).toBe(false);
  });

  it("is false after dispose() drops the queue", async () => {
    const { synth } = deferredSynth();
    const { sink } = recordingSink();
    const pipe = createTtsPipeline({ synth, sink });

    pipe.pushTextDelta("Hello.");
    pipe.end();
    await tick();
    expect(pipe.hasOutstandingWork()).toBe(true);

    pipe.dispose();
    expect(pipe.hasOutstandingWork()).toBe(false);
  });
});
