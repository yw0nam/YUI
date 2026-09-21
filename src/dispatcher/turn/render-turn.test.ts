/**
 * render-turn.test.ts — a finished backend turn arriving as a `render` frame on the push socket.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpressArgs } from "../../contract";
import type { ChatHistoryEntry } from "../../io/chat/chat-history-store";
import type { RenderFrame, RenderSegment, SpeechFrame } from "../../io/chat/push-socket";
import { createSentenceSegmenter } from "../../io/voice/tts/sentence-segmenter";
import type { Logger } from "../../logger";
import { PRE_SPEECH_TIMEOUT_MS } from "../backend/idle-watchdog";
import { makeLogger, makeTurnOutput } from "../test-helpers";
import { createPushTurns, type PushTurns } from "./push-turn";
import { createRenderTurn } from "./render-turn";

/**
 * Mirrors what a cue really meets in the TTS pipeline: text runs through the same sentence
 * segmenter the pipeline uses, and each sentence consumes the one parked cue. A cue parked with no
 * sentence behind it renders nothing, and two segments that the segmenter merges share one cue —
 * which is what the boundary and silent-segment assertions rest on.
 */
function makePendingCuePipeline() {
  const segmenter = createSentenceSegmenter();
  let pendingCue: ExpressArgs | null = null;
  const spoken: { text: string; cue: ExpressArgs | null }[] = [];
  const take = (text: string): void => {
    spoken.push({ text, cue: pendingCue });
    pendingCue = null;
  };
  return {
    spoken,
    setCue(cue: ExpressArgs): void {
      pendingCue = cue;
    },
    pushText(text: string): void {
      for (const sentence of segmenter.push(text)) take(sentence);
    },
    end(): void {
      const rest = segmenter.flush();
      if (rest) take(rest);
    },
    /** A cue still parked when the turn is over never reached the renderer. */
    unconsumed: () => pendingCue,
  };
}

let turnOutput: ReturnType<typeof makeTurnOutput>;
let pushTurns: PushTurns;
let pipeline: ReturnType<typeof makePendingCuePipeline>;
let silentCues: ExpressArgs[];
let logger: Logger;
let records: unknown[];
let transcript: ChatHistoryEntry[];

function frame(segments: RenderSegment[], overrides: Partial<RenderFrame> = {}): RenderFrame {
  return { type: "render", turn_id: "7", source: "hermes", segments, ...overrides };
}

function speech(segments: RenderSegment[], overrides: Partial<SpeechFrame> = {}): SpeechFrame {
  return { type: "speech", turn_id: "7", segments, ...overrides };
}

function turn() {
  records = [];
  transcript = [];
  return createRenderTurn({
    turnOutput,
    pushTurns,
    appendTurnRecord: (record) => records.push(record),
    appendTranscript: (entry) => transcript.push(entry),
    logger,
  });
}

beforeEach(() => {
  turnOutput = makeTurnOutput();
  pushTurns = createPushTurns();
  pipeline = makePendingCuePipeline();
  silentCues = [];
  logger = makeLogger();
  turnOutput.silentCue.mockImplementation((cue: ExpressArgs) => silentCues.push(cue));
  // Route the spy output into the pending-cue pipeline: a cue renders only when a sentence takes it.
  turnOutput.cueWithSpeech.mockImplementation((args: ExpressArgs) => pipeline.setCue(args));
  turnOutput.delta.mockImplementation((text: string) => pipeline.pushText(text));
  turnOutput.end.mockImplementation(() => pipeline.end());
});

describe("render_turn — speaking segments", () => {
  it("hands each segment's cue to the sentence it belongs to, in segment order", () => {
    turn().render(
      frame([
        { cues: [{ emotion_id: "happy", motion_id: "dance" }], speech: "All green." },
        { cues: [{ emotion_id: "curious" }], speech: "Want the list?" },
      ]),
    );

    expect(pipeline.spoken).toEqual([
      { text: "All green.", cue: { emotion_id: "happy", motion_id: "dance" } },
      { text: "Want the list?", cue: { emotion_id: "curious" } },
    ]);
    expect(pipeline.unconsumed()).toBeNull();
    expect(turnOutput.end).toHaveBeenCalledTimes(1);
  });

  it("ends a segment that carries no terminator, so the next one does not swallow it", () => {
    turn().render(
      frame([
        { cues: [{ emotion_id: "happy" }], speech: "All green" },
        { cues: [{ emotion_id: "curious" }], speech: "Want the list?" },
      ]),
    );

    expect(pipeline.spoken).toEqual([
      { text: "All green", cue: { emotion_id: "happy" } },
      { text: "Want the list?", cue: { emotion_id: "curious" } },
    ]);
  });

  it("keeps a segment of several sentences together, each taking the cue in turn", () => {
    turn().render(frame([{ cues: [{ emotion_id: "happy" }], speech: "All green. Every one." }]));

    expect(pipeline.spoken).toEqual([
      { text: "All green.", cue: { emotion_id: "happy" } },
      { text: "Every one.", cue: null },
    ]);
  });

  it("merges a segment's cues so every channel survives", () => {
    turn().render(
      frame([{ cues: [{ motion_id: "wave" }, { emotion_id: "happy" }], speech: "Hi." }]),
    );

    expect(pipeline.spoken[0]!.cue).toEqual({ motion_id: "wave", emotion_id: "happy" });
  });

  it("keeps the later cue when two cues carry the same channel", () => {
    turn().render(
      frame([{ cues: [{ emotion_id: "sad" }, { emotion_id: "happy" }], speech: "Hi." }]),
    );

    expect(pipeline.spoken[0]!.cue).toEqual({ emotion_id: "happy" });
  });

  it("never lets an empty field override the channel already set", () => {
    turn().render(
      frame([
        {
          cues: [
            { emotion_id: "happy", emotion_text: "😆" },
            { emotion_id: "", emotion_text: "" },
          ],
          speech: "Hi.",
        },
      ]),
    );

    expect(pipeline.spoken[0]!.cue).toEqual({ emotion_id: "happy", emotion_text: "😆" });
  });

  it("sends no cue for a segment that carries none", () => {
    turn().render(frame([{ speech: "Hi." }]));

    expect(turnOutput.cueWithSpeech).not.toHaveBeenCalled();
    expect(pipeline.spoken).toEqual([{ text: "Hi.", cue: null }]);
  });

  it("leaves speech in progress alone — the frame queues behind it", () => {
    turn().render(frame([{ speech: "Hello." }]));
    expect(turnOutput.interrupt).not.toHaveBeenCalled();
  });

  it("plays two frames of one turn in the order they arrived", () => {
    const renderTurn = turn();
    renderTurn.render(frame([{ speech: "One moment." }]));
    renderTurn.render(frame([{ speech: "Here it is." }]));

    expect(pipeline.spoken).toEqual([
      { text: "One moment.", cue: null },
      { text: "Here it is.", cue: null },
    ]);
    expect(turnOutput.interrupt).not.toHaveBeenCalled();
  });

  it("releases the barge-in mute before queueing an accepted frame", () => {
    turn().render(frame([{ speech: "Hello." }]));
    expect(turnOutput.releaseMute).toHaveBeenCalledTimes(1);
  });

  it("[SILENT] inside a longer reply is ordinary text", () => {
    turn().render(frame([{ speech: "I said [SILENT] out loud." }]));
    expect(pipeline.spoken[0]!.text).toBe("I said [SILENT] out loud.");
  });
});

describe("render_turn — silent segments", () => {
  it("hands a silent segment's cues to the speech pipeline, which owns the motion hold", () => {
    turn().render(frame([{ cues: [{ emotion_id: "sad", motion_id: "sit" }], speech: "[SILENT]" }]));

    expect(silentCues).toEqual([{ emotion_id: "sad", motion_id: "sit" }]);
    expect(turnOutput.cueWithSpeech).not.toHaveBeenCalled();
    expect(pipeline.unconsumed()).toBeNull();
    expect(turnOutput.end).not.toHaveBeenCalled();
  });

  it("renders the cues of a segment whose speech is only whitespace", () => {
    turn().render(frame([{ cues: [{ emotion_id: "happy" }], speech: "   " }]));

    expect(silentCues).toEqual([{ emotion_id: "happy" }]);
  });

  it("renders the cues of a segment carrying no speech field at all", () => {
    turn().render(frame([{ cues: [{ motion_id: "wave" }] }]));

    expect(silentCues).toEqual([{ motion_id: "wave" }]);
  });

  it("merges a silent segment's cues into one", () => {
    turn().render(frame([{ cues: [{ motion_id: "wave" }, { emotion_id: "happy" }], speech: "" }]));

    expect(silentCues).toEqual([{ emotion_id: "happy", motion_id: "wave" }]);
  });

  it("sends nothing for a silent segment that carries no cue", () => {
    turn().render(frame([{ speech: "[SILENT]" }]));

    expect(silentCues).toEqual([]);
    expect(turnOutput.cueWithSpeech).not.toHaveBeenCalled();
  });

  it("mixes the two paths inside one render, each in segment order", () => {
    turn().render(
      frame([
        { cues: [{ emotion_id: "sad" }], speech: "[SILENT]" },
        { cues: [{ emotion_id: "happy" }], speech: "Here." },
      ]),
    );

    expect(silentCues).toEqual([{ emotion_id: "sad" }]);
    expect(pipeline.spoken).toEqual([{ text: "Here.", cue: { emotion_id: "happy" } }]);
  });

  it("a cue sink that throws never breaks the rest of the render", () => {
    turnOutput.silentCue.mockImplementation(() => {
      throw new Error("renderer gone");
    });
    const r = createRenderTurn({ turnOutput, pushTurns, logger });

    expect(() =>
      r.render(frame([{ cues: [{ emotion_id: "sad" }] }, { speech: "Here." }])),
    ).not.toThrow();
    expect(pipeline.spoken).toEqual([{ text: "Here.", cue: null }]);
  });
});

describe("render_turn — segment order", () => {
  it("[speaking, silent] defers the silent cue until the preceding speech finishes playing", () => {
    turn().render(
      frame([
        { speech: "Here." },
        { cues: [{ emotion_id: "sad", motion_id: "sit" }], speech: "[SILENT]" },
      ]),
    );

    expect(silentCues).toEqual([]);
    expect(turnOutput.onQueueDrained).toHaveBeenCalledOnce();

    const drained = turnOutput.onQueueDrained.mock.calls[0]![0] as () => void;
    drained();

    expect(silentCues).toEqual([{ emotion_id: "sad", motion_id: "sit" }]);
  });

  it("[silent] alone still applies at once, with no speaking segment in the frame", () => {
    turn().render(frame([{ cues: [{ emotion_id: "sad" }], speech: "[SILENT]" }]));

    expect(silentCues).toEqual([{ emotion_id: "sad" }]);
    expect(turnOutput.onQueueDrained).not.toHaveBeenCalled();
  });

  it("[silent] waits on the queue when speech from an earlier frame is still owed", () => {
    turnOutput.hasOutstandingSpeech.mockReturnValue(true);
    turn().render(frame([{ cues: [{ emotion_id: "sad" }], speech: "[SILENT]" }]));

    expect(silentCues).toEqual([]);
    expect(turnOutput.onQueueDrained).toHaveBeenCalledOnce();

    const drained = turnOutput.onQueueDrained.mock.calls[0]![0] as () => void;
    drained();

    expect(silentCues).toEqual([{ emotion_id: "sad" }]);
  });

  it("[silent, speaking] applies the silent cue first, without waiting on the speech that follows", () => {
    turn().render(
      frame([
        { cues: [{ emotion_id: "sad" }], speech: "[SILENT]" },
        { cues: [{ emotion_id: "happy" }], speech: "Here." },
      ]),
    );

    expect(silentCues).toEqual([{ emotion_id: "sad" }]);
    expect(turnOutput.onQueueDrained).not.toHaveBeenCalled();
  });
});

describe("render_turn — a turn the user stopped", () => {
  function cutSeven(): void {
    pushTurns.opened("7");
    pushTurns.cut();
  }

  it("drops every frame of a cut turn", () => {
    cutSeven();
    turn().render(
      frame([
        { cues: [{ emotion_id: "happy" }], speech: "Here it is." },
        { cues: [{ emotion_id: "sad" }], speech: "[SILENT]" },
      ]),
    );

    expect(pipeline.spoken).toEqual([]);
    expect(turnOutput.delta).not.toHaveBeenCalled();
    expect(turnOutput.cueWithSpeech).not.toHaveBeenCalled();
    expect(turnOutput.end).not.toHaveBeenCalled();
    expect(turnOutput.releaseMute).not.toHaveBeenCalled();
    expect(silentCues).toEqual([]);
    expect(transcript).toEqual([]);
    expect(records).toEqual([]);
  });

  it("logs the dropped frame with the turn it belonged to and the cut that swallowed it", () => {
    cutSeven();
    turn().render(frame([{ speech: "Here it is." }]));

    expect(logger.info).toHaveBeenCalledWith("render", {
      source: "hermes",
      turn_id: "7",
      segments: 1,
      dropped: "cut_turn",
      stopped_count: 1,
    });
  });

  it("plays a frame of a turn the user never stopped", () => {
    pushTurns.opened("7");
    pushTurns.opened("8");
    pushTurns.cut();
    pushTurns.opened("9");
    turn().render(frame([{ speech: "Here it is." }], { turn_id: "9" }));

    expect(pipeline.spoken).toEqual([{ text: "Here it is.", cue: null }]);
  });

  it("plays a frame of a turn the backend already ended", () => {
    pushTurns.opened("7");
    pushTurns.ended("7");
    turn().render(frame([{ speech: "Here it is." }]));

    expect(pipeline.spoken).toEqual([{ text: "Here it is.", cue: null }]);
  });

  it("tells its caller the frame was dropped", () => {
    cutSeven();

    expect(turn().render(frame([{ speech: "Here it is." }]))).toBe(false);
  });

  it("tells its caller a frame it played was accepted", () => {
    expect(turn().render(frame([{ speech: "Here it is." }]))).toBe(true);
  });

  it("plays a reply the backend started on its own, cut or not", () => {
    cutSeven();
    turn().render(frame([{ speech: "One more thing." }], { turn_id: "hermes-1" }));

    expect(pipeline.spoken).toEqual([{ text: "One more thing.", cue: null }]);
    expect(turnOutput.releaseMute).toHaveBeenCalledTimes(1);
  });
});

describe("render_turn — transcript", () => {
  it("puts the spoken reply in the transcript as one assistant turn", () => {
    turn().render(frame([{ speech: "All green." }, { speech: "Want the list?" }]));

    expect(transcript).toEqual([
      { role: "assistant", text: "All green. Want the list?", ts: expect.any(Number) },
    ]);
  });

  it("leaves the silent segments out of the transcribed reply", () => {
    turn().render(frame([{ speech: "[SILENT]" }, { speech: "Here." }, { speech: "  " }]));

    expect(transcript).toEqual([{ role: "assistant", text: "Here.", ts: expect.any(Number) }]);
  });

  it("writes nothing for a reply that spoke nothing at all", () => {
    turn().render(frame([{ cues: [{ emotion_id: "sad" }], speech: "[SILENT]" }]));

    expect(transcript).toEqual([]);
  });

  it("a failed transcript append never breaks the render", () => {
    const r = createRenderTurn({
      turnOutput,
      pushTurns,
      appendTranscript: vi.fn(() => {
        throw new Error("store gone");
      }),
      logger,
    });

    expect(() => r.render(frame([{ speech: "Hello." }]))).not.toThrow();
    expect(pipeline.spoken[0]!.text).toBe("Hello.");
  });
});

describe("render_turn — records", () => {
  it("marks a silent render as having spoken nothing", () => {
    turn().render(frame([{ cues: [{ emotion_id: "sad" }], speech: "  [SILENT] " }]));
    expect(records[0]).toMatchObject({ spoke_text: false, segments: 1 });
  });

  it("an empty segment list closes the turn without speaking", () => {
    turn().render(frame([]));

    expect(turnOutput.interrupt).not.toHaveBeenCalled();
    expect(pipeline.spoken).toEqual([]);
    expect(silentCues).toEqual([]);
    expect(records[0]).toMatchObject({ spoke_text: false, segments: 0 });
  });

  it("writes a push.render turn record naming the source, turn and segment count", () => {
    turn().render(frame([{ cues: [{ emotion_id: "happy" }], speech: "Hi." }, { speech: "Bye." }]));

    expect(records).toEqual([
      {
        type: "turn",
        ts: expect.any(Number),
        event_name: "push.render",
        trigger_kind: "push",
        source: "hermes",
        turn_id: "7",
        segments: 2,
        spoke_text: true,
        queued_behind: false,
      },
    ]);
  });

  it("marks a frame that arrived while speech was still owed", () => {
    turnOutput.hasOutstandingSpeech.mockReturnValue(true);
    turn().render(frame([{ speech: "Here it is." }]));

    expect(records[0]).toMatchObject({ queued_behind: true });
    expect(logger.info).toHaveBeenCalledWith("render", {
      source: "hermes",
      turn_id: "7",
      segments: 1,
      spoke_text: true,
      queued_behind: true,
    });
  });

  it("names the turn the reply belongs to in the record", () => {
    turn().render(frame([{ speech: "Done." }], { turn_id: "hermes-1" }));
    expect(records[0]).toMatchObject({ turn_id: "hermes-1" });
  });

  it("logs the render with its source and segment count", () => {
    turn().render(frame([{ speech: "Hi." }]));
    expect(logger.info).toHaveBeenCalledWith("render", {
      source: "hermes",
      turn_id: "7",
      segments: 1,
      spoke_text: true,
      queued_behind: false,
    });
  });

  it("a failed record append never breaks the render", () => {
    const r = createRenderTurn({
      turnOutput,
      pushTurns,
      appendTurnRecord: vi.fn(() => {
        throw new Error("disk gone");
      }),
      logger,
    });

    expect(() => r.render(frame([{ speech: "Hello." }]))).not.toThrow();
    expect(pipeline.spoken[0]!.text).toBe("Hello.");
  });
});

describe("render_turn — a reply streamed as speech frames", () => {
  it("speaks each sentence as its frame arrives, with the cue its segment carries", () => {
    const r = turn();
    r.stream(speech([{ cues: [{ emotion_id: "happy" }], speech: "All green." }]));

    expect(pipeline.spoken).toEqual([{ text: "All green.", cue: { emotion_id: "happy" } }]);

    r.stream(speech([{ cues: [{ emotion_id: "curious" }], speech: "Every one." }]));

    expect(pipeline.spoken).toEqual([
      { text: "All green.", cue: { emotion_id: "happy" } },
      { text: "Every one.", cue: { emotion_id: "curious" } },
    ]);
    expect(turnOutput.end).not.toHaveBeenCalled();
  });

  it("plays the stream and the turn's render as one utterance with a single end()", () => {
    const r = turn();
    r.stream(speech([{ speech: "All green." }]));
    r.stream(speech([{ speech: "Every one." }]));
    r.render(frame([{ cues: [{ emotion_id: "curious" }], speech: "Want the list?" }]));

    expect(pipeline.spoken).toEqual([
      { text: "All green.", cue: null },
      { text: "Every one.", cue: null },
      { text: "Want the list?", cue: { emotion_id: "curious" } },
    ]);
    expect(turnOutput.end).toHaveBeenCalledOnce();
    expect(turnOutput.end.mock.invocationCallOrder[0]).toBeGreaterThan(
      turnOutput.delta.mock.invocationCallOrder.at(-1)!,
    );
  });

  it.each<[string, RenderSegment[]]>([
    ["no segments", []],
    ["only a silent segment", [{ cues: [{ emotion_id: "happy" }], speech: "" }]],
  ])("ends the utterance on the turn's render carrying %s", (_label, segments) => {
    const r = turn();
    r.stream(speech([{ speech: "All green." }]));
    r.render(frame(segments));

    expect(turnOutput.end).toHaveBeenCalledOnce();
  });

  it("writes the streamed and rendered sentences to the transcript as one entry", () => {
    const r = turn();
    r.stream(speech([{ speech: "All green." }]));
    r.stream(speech([{ speech: "Every one." }]));

    expect(transcript).toEqual([]);

    r.render(frame([{ speech: "Want the list?" }]));

    expect(transcript).toEqual([
      { role: "assistant", text: "All green. Every one. Want the list?", ts: expect.any(Number) },
    ]);
  });

  it("writes the streamed sentences as one entry when the render carries none", () => {
    const r = turn();
    r.stream(speech([{ speech: "All green." }]));
    r.render(frame([]));

    expect(transcript).toEqual([{ role: "assistant", text: "All green.", ts: expect.any(Number) }]);
  });

  it("writes a render record for the render alone", () => {
    const r = turn();
    r.stream(speech([{ speech: "All green." }]));

    expect(records).toEqual([]);

    r.render(frame([]));

    expect(records).toHaveLength(1);
  });

  it("releases the barge-in mute before a speech frame's sentence is queued", () => {
    turn().stream(speech([{ speech: "All green." }]));

    expect(turnOutput.releaseMute).toHaveBeenCalledOnce();
    expect(turnOutput.releaseMute.mock.invocationCallOrder[0]).toBeLessThan(
      turnOutput.delta.mock.invocationCallOrder[0]!,
    );
  });

  it("brings the thinking bridge down on the first speech frame, once for the whole turn", () => {
    const onFirstRender = vi.fn();
    const onFrame = vi.fn();
    pushTurns.opened("7");
    void pushTurns.awaitTurnEnd("7", { onFirstRender, onFrame });
    const r = turn();

    r.stream(speech([{ speech: "All green." }]));

    expect(onFirstRender).toHaveBeenCalledOnce();

    r.stream(speech([{ speech: "Every one." }]));
    r.render(frame([]));

    expect(onFirstRender).toHaveBeenCalledOnce();
    expect(onFrame).toHaveBeenCalledTimes(3);
  });

  it("logs each speech frame with its turn", () => {
    turn().stream(speech([{ speech: "All green." }]));

    expect(logger.info).toHaveBeenCalledWith("push.speech", { turn_id: "7", segments: 1 });
  });
});

describe("render_turn — a streamed reply closed without its render", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("close(turnId) ends the open utterance and writes its sentences as one entry", () => {
    const r = turn();
    r.stream(speech([{ speech: "All green." }]));
    r.stream(speech([{ speech: "Every one." }]));
    r.close("7");

    expect(turnOutput.end).toHaveBeenCalledOnce();
    expect(transcript).toEqual([
      { role: "assistant", text: "All green. Every one.", ts: expect.any(Number) },
    ]);
  });

  it("close() with no turn named ends whichever utterance is open", () => {
    const r = turn();
    r.stream(speech([{ speech: "All green." }], { turn_id: "hermes-1" }));
    r.close();

    expect(turnOutput.end).toHaveBeenCalledOnce();
    expect(transcript).toHaveLength(1);
  });

  it("close of another turn leaves the open utterance alone", () => {
    const r = turn();
    r.stream(speech([{ speech: "All green." }]));
    r.close("8");

    expect(turnOutput.end).not.toHaveBeenCalled();
    expect(transcript).toEqual([]);
  });

  it("close with nothing open ends nothing", () => {
    const r = turn();
    r.close("7");
    r.close();

    expect(turnOutput.end).not.toHaveBeenCalled();
  });

  it("a silent render of the turn after its close plays as a reply of its own", () => {
    const r = turn();
    r.stream(speech([{ speech: "All green." }]));
    r.close("7");
    r.render(frame([]));

    expect(turnOutput.end).toHaveBeenCalledOnce();
    expect(transcript).toHaveLength(1);
  });

  it.each([
    ["the client's", "7"],
    ["a backend-minted", "hermes-1"],
  ])("ends %s turn's utterance once the frame wait passes with no frame", (_label, turnId) => {
    vi.useFakeTimers();
    const r = turn();
    r.stream(speech([{ speech: "All green." }], { turn_id: turnId }));

    vi.advanceTimersByTime(PRE_SPEECH_TIMEOUT_MS - 1);
    expect(turnOutput.end).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(turnOutput.end).toHaveBeenCalledOnce();
    expect(transcript).toEqual([{ role: "assistant", text: "All green.", ts: expect.any(Number) }]);
  });

  it("restarts the frame wait on every speech frame", () => {
    vi.useFakeTimers();
    const r = turn();
    r.stream(speech([{ speech: "All green." }]));
    vi.advanceTimersByTime(PRE_SPEECH_TIMEOUT_MS - 1);
    r.stream(speech([{ speech: "Every one." }]));
    vi.advanceTimersByTime(PRE_SPEECH_TIMEOUT_MS - 1);

    expect(turnOutput.end).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(turnOutput.end).toHaveBeenCalledOnce();
  });

  it.each<[string, (r: ReturnType<typeof turn>) => void]>([
    ["the turn's render", (r) => r.render(frame([]))],
    ["close", (r) => r.close("7")],
    ["dispose", (r) => r.dispose()],
  ])("stops the frame wait on %s", (_label, settle) => {
    vi.useFakeTimers();
    const r = turn();
    r.stream(speech([{ speech: "All green." }]));
    settle(r);
    const ends = turnOutput.end.mock.calls.length;

    vi.advanceTimersByTime(PRE_SPEECH_TIMEOUT_MS);

    expect(turnOutput.end).toHaveBeenCalledTimes(ends);
  });

  it("a render of another turn closes the open utterance before it plays", () => {
    const r = turn();
    r.stream(speech([{ speech: "All green." }]));
    r.render(frame([{ speech: "Something else." }], { turn_id: "8" }));

    expect(turnOutput.end).toHaveBeenCalledTimes(2);
    expect(turnOutput.end.mock.invocationCallOrder[0]).toBeLessThan(
      turnOutput.delta.mock.invocationCallOrder[1]!,
    );
    expect(transcript.map((entry) => entry.text)).toEqual(["All green.", "Something else."]);
  });

  it("a speech frame of another turn closes the open utterance before it plays", () => {
    const r = turn();
    r.stream(speech([{ speech: "All green." }]));
    r.stream(speech([{ speech: "Something else." }], { turn_id: "8" }));

    expect(turnOutput.end).toHaveBeenCalledOnce();
    expect(turnOutput.end.mock.invocationCallOrder[0]).toBeLessThan(
      turnOutput.delta.mock.invocationCallOrder[1]!,
    );
    expect(transcript.map((entry) => entry.text)).toEqual(["All green."]);

    r.render(frame([], { turn_id: "8" }));

    expect(turnOutput.end).toHaveBeenCalledTimes(2);
    expect(transcript.map((entry) => entry.text)).toEqual(["All green.", "Something else."]);
  });
});

describe("render_turn — a streamed reply the user stopped", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function streamThenCut(r: ReturnType<typeof turn>): void {
    pushTurns.opened("7");
    r.stream(speech([{ speech: "All green." }]));
    pushTurns.cut();
    r.drop("7");
  }

  it("drop(turnId) writes the sentences accepted so far and leaves playback to the interruption", () => {
    const r = turn();
    streamThenCut(r);

    expect(transcript).toEqual([{ role: "assistant", text: "All green.", ts: expect.any(Number) }]);
    expect(turnOutput.end).not.toHaveBeenCalled();
  });

  it("drops the cut turn's later frames without a second transcript entry", () => {
    const r = turn();
    streamThenCut(r);
    r.stream(speech([{ speech: "Every one." }]));
    r.render(frame([{ speech: "Want the list?" }]));

    expect(pipeline.spoken).toEqual([{ text: "All green.", cue: null }]);
    expect(turnOutput.end).not.toHaveBeenCalled();
    expect(transcript).toHaveLength(1);
  });

  it("logs a dropped speech frame with its turn and the cut that swallowed it", () => {
    const r = turn();
    streamThenCut(r);
    r.stream(speech([{ speech: "Every one." }]));

    expect(logger.info).toHaveBeenCalledWith("push.speech", {
      turn_id: "7",
      segments: 1,
      dropped: "cut_turn",
      stopped_count: 1,
    });
  });

  it("stops the frame wait", () => {
    vi.useFakeTimers();
    const r = turn();
    streamThenCut(r);

    vi.advanceTimersByTime(PRE_SPEECH_TIMEOUT_MS);

    expect(turnOutput.end).not.toHaveBeenCalled();
    expect(transcript).toHaveLength(1);
  });

  it("drop of another turn leaves the open utterance alone", () => {
    const r = turn();
    r.stream(speech([{ speech: "All green." }], { turn_id: "hermes-1" }));
    r.drop("7");
    r.render(frame([], { turn_id: "hermes-1" }));

    expect(turnOutput.end).toHaveBeenCalledOnce();
    expect(transcript).toHaveLength(1);
  });

  it("a dropped speech frame leaves another turn's open utterance alone", () => {
    const r = turn();
    streamThenCut(r);
    r.stream(speech([{ speech: "One more thing." }], { turn_id: "hermes-1" }));
    r.stream(speech([{ speech: "Every one." }]));

    expect(turnOutput.end).not.toHaveBeenCalled();
  });
});
