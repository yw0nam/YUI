/**
 * render-turn.test.ts — a finished backend turn arriving as a `render` frame on the push socket.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderFrame, RenderSegment } from "../io/push-socket";
import type { Logger } from "../logger";
import { createRenderTurn } from "./render-turn";
import { makeLogger, makeTurnOutput } from "./test-helpers";

let turnOutput: ReturnType<typeof makeTurnOutput>;
let logger: Logger;
let records: unknown[];

function frame(segments: RenderSegment[], overrides: Partial<RenderFrame> = {}): RenderFrame {
  return { type: "render", turn_id: "7", source: "hermes", segments, ...overrides };
}

function renderer() {
  records = [];
  return createRenderTurn({
    turnOutput,
    appendTurnRecord: (record) => records.push(record),
    logger,
  });
}

beforeEach(() => {
  turnOutput = makeTurnOutput();
  logger = makeLogger();
});

describe("render_turn", () => {
  it("plays each segment's cues before its speech, in segment order", () => {
    const order: string[] = [];
    turnOutput.cue.mockImplementation((args: { emotion_id?: string }) =>
      order.push(`cue:${args.emotion_id}`),
    );
    turnOutput.delta.mockImplementation((text: string) => order.push(`say:${text}`));
    turnOutput.end.mockImplementation(() => order.push("end"));

    renderer().render(
      frame([
        { cues: [{ emotion_id: "happy", motion_id: "dance" }], speech: "All green." },
        { cues: [{ emotion_id: "curious" }], speech: "Want the list?" },
      ]),
    );

    expect(order).toEqual([
      "cue:happy",
      "say:All green.",
      "cue:curious",
      "say:Want the list?",
      "end",
    ]);
    expect(turnOutput.cue).toHaveBeenNthCalledWith(1, { emotion_id: "happy", motion_id: "dance" });
  });

  it("interrupts speech in progress before rendering", () => {
    renderer().render(frame([{ speech: "Hello." }]));
    expect(turnOutput.interrupt).toHaveBeenCalledTimes(1);
  });

  it("a bare [SILENT] segment is silence, and its cues still play", () => {
    renderer().render(frame([{ cues: [{ emotion_id: "sad" }], speech: "  [SILENT] " }]));

    expect(turnOutput.delta).not.toHaveBeenCalled();
    expect(turnOutput.end).not.toHaveBeenCalled();
    expect(turnOutput.cue).toHaveBeenCalledWith({ emotion_id: "sad" });
    expect(records[0]).toMatchObject({ spoke_text: false, segments: 1 });
  });

  it("empty speech is silence", () => {
    renderer().render(frame([{ speech: "   " }, { cues: [{ emotion_id: "sad" }] }]));

    expect(turnOutput.delta).not.toHaveBeenCalled();
    expect(records[0]).toMatchObject({ spoke_text: false, segments: 2 });
  });

  it("speaks the segments that carry speech and skips the silent ones", () => {
    renderer().render(frame([{ speech: "[SILENT]" }, { speech: "Here." }]));

    expect(turnOutput.delta).toHaveBeenCalledTimes(1);
    expect(turnOutput.delta).toHaveBeenCalledWith("Here.");
    expect(turnOutput.end).toHaveBeenCalledTimes(1);
  });

  it("[SILENT] inside a longer reply is ordinary text", () => {
    renderer().render(frame([{ speech: "I said [SILENT] out loud." }]));
    expect(turnOutput.delta).toHaveBeenCalledWith("I said [SILENT] out loud.");
  });

  it("an empty segment list closes the turn without speaking", () => {
    renderer().render(frame([]));

    expect(turnOutput.interrupt).toHaveBeenCalledTimes(1);
    expect(turnOutput.delta).not.toHaveBeenCalled();
    expect(turnOutput.cue).not.toHaveBeenCalled();
    expect(records[0]).toMatchObject({ spoke_text: false, segments: 0 });
  });

  it("writes a push.render turn record naming the source, turn and segment count", () => {
    renderer().render(
      frame([{ cues: [{ emotion_id: "happy" }], speech: "Hi." }, { speech: "Bye." }]),
    );

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
      },
    ]);
  });

  it("omits turn_id on a turn the backend started on its own", () => {
    renderer().render(frame([{ speech: "Done." }], { turn_id: null }));
    expect(records[0]).not.toHaveProperty("turn_id");
  });

  it("logs the render with its source and segment count", () => {
    renderer().render(frame([{ speech: "Hi." }]));
    expect(logger.info).toHaveBeenCalledWith("render", {
      source: "hermes",
      turn_id: "7",
      segments: 1,
      spoke_text: true,
    });
  });

  it("a failed record append never breaks the render", () => {
    const r = createRenderTurn({
      turnOutput,
      appendTurnRecord: vi.fn(() => {
        throw new Error("disk gone");
      }),
      logger,
    });

    expect(() => r.render(frame([{ speech: "Hello." }]))).not.toThrow();
    expect(turnOutput.delta).toHaveBeenCalledWith("Hello.");
  });
});
