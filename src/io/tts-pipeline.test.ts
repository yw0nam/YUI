/**
 * tts-pipeline.test.ts — orchestration: segment → synth (concurrent) → ordered playback (TDD red, #14).
 *
 * 핵심 보장(#14 core):
 *  - synth는 동시 실행, 응답이 뒤바뀌어 와도 playback은 submission index 순서로만.
 *  - emotion_text는 문장 emit 시점에 snapshot되어 prefix로 prepend (verbatim free text, 발명 금지).
 *  - synth 에러는 큐를 deadlock시키지 않고 해당 index를 skip.
 *
 * fake synth(제어 가능한 promise) + fake AudioSink(재생 순서 기록)로 검증 — 실제 오디오/네트워크 없음.
 */

import { describe, it, expect, vi } from "vitest";
import type { EndpointsConfig } from "../contract";
import { createTtsPipeline } from "./tts-pipeline";
import type { AudioSink } from "./audio-player";
import type { Logger } from "../logger";

const CONFIG: EndpointsConfig = {
  chat_base_url: "http://localhost:8643/v1",
  chat_endpoint: "/v1/responses",
  stt_base_url: "http://localhost:5517",
  tts_base_url: "http://localhost:8092",
};

/** index를 식별 가능한 1바이트 ArrayBuffer. */
function bufFor(n: number): ArrayBuffer {
  const b = new Uint8Array([n]);
  return b.buffer;
}
const bufId = (buf: ArrayBuffer): number => new Uint8Array(buf)[0];

/** 호출 시점에 resolve/reject를 제어할 수 있는 fake synth. */
function deferredSynth() {
  const resolvers: Array<{ resolve: (b: ArrayBuffer) => void; reject: (e: unknown) => void; input: string }> = [];
  const inputs: string[] = [];
  const signals: Array<AbortSignal | undefined> = [];
  let inFlight = 0;
  let maxConcurrent = 0;
  const synth = (input: string, signal?: AbortSignal): Promise<ArrayBuffer> => {
    inputs.push(input);
    signals.push(signal);
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
  return { synth, resolvers, inputs, signals, peakConcurrency: () => maxConcurrent };
}

/** 재생 순서를 기록하는 fake sink. play는 외부에서 finish할 때까지 pending. */
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
    const pipe = createTtsPipeline({ config: CONFIG, synth, sink, maxInflight: 3 });

    pipe.pushTextDelta("First. Second. Third.");
    await tick();
    expect(resolvers).toHaveLength(3);

    // 역순으로 resolve: 2, then 1, then 0.
    resolvers[2].resolve(bufFor(2));
    resolvers[1].resolve(bufFor(1));
    await tick();
    // index 0이 아직 안 왔으므로 아무것도 재생되면 안 된다.
    expect(playedOrder).toEqual([]);

    resolvers[0].resolve(bufFor(0));
    await tick();
    expect(playedOrder).toEqual([0]); // 0 재생 중, 끝나길 대기
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
    const pipe = createTtsPipeline({ config: CONFIG, synth, sink });

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
    const pipe = createTtsPipeline({ config: CONFIG, synth, sink, maxInflight: 3 });

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
    const pipe = createTtsPipeline({ config: CONFIG, synth, sink });

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
    const pipe = createTtsPipeline({ config: CONFIG, synth, sink, maxInflight: 0 });

    pipe.pushTextDelta("First. Second.");
    await tick();
    expect(resolvers).toHaveLength(1);
    expect(peakConcurrency()).toBe(1);
    resolvers[0].resolve(bufFor(0));
  });
});

describe("createTtsPipeline — emotion_text prefix", () => {
  it("prepends snapshotted emotion_text to the sentence sent to synth", async () => {
    const { synth, inputs, resolvers } = deferredSynth();
    const { sink } = recordingSink();
    const pipe = createTtsPipeline({ config: CONFIG, synth, sink });

    pipe.setEmotionText("[whisper]");
    pipe.pushTextDelta("Can you hear me?");
    await tick();
    expect(inputs).toEqual(["[whisper] Can you hear me?"]);
    resolvers[0].resolve(bufFor(0));
  });

  it("sends plain text when emotion_text is cleared with null", async () => {
    const { synth, inputs } = deferredSynth();
    const { sink } = recordingSink();
    const pipe = createTtsPipeline({ config: CONFIG, synth, sink });

    pipe.setEmotionText("[whisper]");
    pipe.setEmotionText(null);
    pipe.pushTextDelta("Plain sentence.");
    await tick();
    expect(inputs).toEqual(["Plain sentence."]);
  });

  it("applies a mid-stream emotion_text change only to subsequently-emitted segments (maxInflight: 3)", async () => {
    const { synth, inputs } = deferredSynth();
    const { sink } = recordingSink();
    const pipe = createTtsPipeline({ config: CONFIG, synth, sink, maxInflight: 3 });

    pipe.setEmotionText("[happy]");
    pipe.pushTextDelta("One. ");
    pipe.setEmotionText("[sad]");
    pipe.pushTextDelta("Two. ");
    await tick();
    expect(inputs).toEqual(["[happy] One.", "[sad] Two."]);
  });
});

describe("createTtsPipeline — end() flush", () => {
  it("flushes the segmenter remainder as a final segment (maxInflight: 3)", async () => {
    const { synth, inputs } = deferredSynth();
    const { sink } = recordingSink();
    const pipe = createTtsPipeline({ config: CONFIG, synth, sink, maxInflight: 3 });

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
    const pipe = createTtsPipeline({ config: CONFIG, synth, sink, maxInflight: 3 });

    pipe.pushTextDelta("A. B. C.");
    await tick();

    resolvers[0].reject(new Error("synth boom"));
    resolvers[1].resolve(bufFor(1));
    resolvers[2].resolve(bufFor(2));
    await tick();
    // index 0 실패 → skip, 1부터 재생.
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
    const pipe = createTtsPipeline({ config: CONFIG, synth, sink });
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
    const pipe = createTtsPipeline({ config: CONFIG, synth, sink, onPlaybackEnd, maxInflight: 3 });

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
    const pipe = createTtsPipeline({ config: CONFIG, synth, sink, onPlaybackEnd });

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
    const pipe = createTtsPipeline({ config: CONFIG, synth, sink, onPlaybackEnd });

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
    const pipe = createTtsPipeline({ config: CONFIG, synth, sink, onPlaybackEnd, maxInflight: 3 });

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
    const pipe = createTtsPipeline({ config: CONFIG, synth, sink, onPlaybackEnd, maxInflight: 3 });

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
});

describe("createTtsPipeline — dispose()", () => {
  it("stops the sink, aborts in-flight synths, and makes no further play calls (maxInflight: 3)", async () => {
    const { synth, resolvers, signals } = deferredSynth();
    const { sink, playedOrder, stopMock } = recordingSink();
    const pipe = createTtsPipeline({ config: CONFIG, synth, sink, maxInflight: 3 });

    pipe.pushTextDelta("One. Two.");
    await tick();
    expect(signals[0]).toBeInstanceOf(AbortSignal);

    pipe.dispose();
    expect(stopMock).toHaveBeenCalled();
    expect(signals[0]?.aborted).toBe(true);

    // dispose 이후 늦게 도착한 synth 결과는 재생되지 않는다.
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
    const pipe = createTtsPipeline({ config: CONFIG, synth, sink, logger });

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
    const pipe = createTtsPipeline({ config: CONFIG, synth, sink, logger });

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
    const pipe = createTtsPipeline({ config: CONFIG, synth, sink, logger });

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
    const pipe = createTtsPipeline({ config: CONFIG, synth, sink, logger });

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
    const pipe = createTtsPipeline({ config: CONFIG, synth, sink, logger });

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
    const pipe = createTtsPipeline({ config: CONFIG, synth, sink, logger });

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
    const pipe = createTtsPipeline({ config: CONFIG, synth, sink, logger });

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
    const pipe = createTtsPipeline({ config: CONFIG, synth, sink, logger, onPlaybackEnd, maxInflight: 3 });

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
