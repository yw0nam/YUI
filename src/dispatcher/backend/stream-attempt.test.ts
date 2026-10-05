import { describe, expect, it, vi } from "vitest";
import type { ChatStreamEvent } from "../../io/chat/stream/chat-client";
import { CONFIG, deltaEvent, makeLogger, makeTurnOutput, turnOf, userEnv } from "../test-helpers";
import { createStreamAttempt } from "./stream-attempt";

describe("createStreamAttempt", () => {
  it("returns a stream error with its status and whether speech had streamed, after cleaning up the speech", async () => {
    const turnOutput = makeTurnOutput();
    const events: ChatStreamEvent[] = [
      deltaEvent("hello"),
      { type: "error", message: "gone", status: 404 },
    ];
    const attempt = createStreamAttempt(
      { config: CONFIG, turnOutput },
      makeLogger(),
      async function* () {
        yield* events;
      },
    );

    const result = await attempt.run({
      turn: turnOf(userEnv()),
      owner: "stream:1",
      abort: vi.fn(),
      request: { input: [], signal: new AbortController().signal },
      streamOpts: {},
      endThinking: vi.fn(),
    });

    expect(result).toEqual({
      kind: "stream_error",
      message: "gone",
      status: 404,
      streamedAny: true,
    });
    expect(turnOutput.delta).toHaveBeenCalledWith("hello");
    expect(turnOutput.abort).toHaveBeenCalledTimes(1);
  });
});
