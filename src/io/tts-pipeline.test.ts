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
  const synth = (input: string, signal?: AbortSignal): Promise<ArrayBuffer> => {
    inputs.push(input);
    signals.push(signal);
    return new Promise<ArrayBuffer>((resolve, reject) => {
      resolvers.push({ resolve, reject, input });
    });
  };
  return { synth, resolvers, inputs, signals };
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
  it("plays in submission index order even when synths resolve out of order", async () => {
    const { synth, resolvers } = deferredSynth();
    const { sink, playedOrder, finish } = recordingSink();
    const pipe = createTtsPipeline({ config: CONFIG, synth, sink });

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

  it("applies a mid-stream emotion_text change only to subsequently-emitted segments", async () => {
    const { synth, inputs } = deferredSynth();
    const { sink } = recordingSink();
    const pipe = createTtsPipeline({ config: CONFIG, synth, sink });

    pipe.setEmotionText("[happy]");
    pipe.pushTextDelta("One. ");
    pipe.setEmotionText("[sad]");
    pipe.pushTextDelta("Two. ");
    await tick();
    expect(inputs).toEqual(["[happy] One.", "[sad] Two."]);
  });
});

describe("createTtsPipeline — end() flush", () => {
  it("flushes the segmenter remainder as a final segment", async () => {
    const { synth, inputs } = deferredSynth();
    const { sink } = recordingSink();
    const pipe = createTtsPipeline({ config: CONFIG, synth, sink });

    pipe.pushTextDelta("Complete. trailing remainder");
    await tick();
    expect(inputs).toEqual(["Complete."]);
    pipe.end();
    await tick();
    expect(inputs).toEqual(["Complete.", "trailing remainder"]);
  });
});

describe("createTtsPipeline — error resilience", () => {
  it("a synth rejection on one index does not block later indices", async () => {
    const { synth, resolvers } = deferredSynth();
    const { sink, playedOrder, finish } = recordingSink();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const pipe = createTtsPipeline({ config: CONFIG, synth, sink });

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
  it("fires exactly once after end() and the last queued chunk finishes", async () => {
    const { synth, resolvers } = deferredSynth();
    const { sink, finish } = recordingSink();
    const onPlaybackEnd = vi.fn();
    const pipe = createTtsPipeline({ config: CONFIG, synth, sink, onPlaybackEnd });

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

  it("fires when every synth fails so no chunk plays", async () => {
    const { synth, resolvers } = deferredSynth();
    const { sink, playedOrder } = recordingSink();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onPlaybackEnd = vi.fn();
    const pipe = createTtsPipeline({ config: CONFIG, synth, sink, onPlaybackEnd });

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

  it("fires after a mix of failed and played chunks drains", async () => {
    const { synth, resolvers } = deferredSynth();
    const { sink, playedOrder, finish } = recordingSink();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onPlaybackEnd = vi.fn();
    const pipe = createTtsPipeline({ config: CONFIG, synth, sink, onPlaybackEnd });

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
  it("stops the sink, aborts in-flight synths, and makes no further play calls", async () => {
    const { synth, resolvers, signals } = deferredSynth();
    const { sink, playedOrder, stopMock } = recordingSink();
    const pipe = createTtsPipeline({ config: CONFIG, synth, sink });

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
