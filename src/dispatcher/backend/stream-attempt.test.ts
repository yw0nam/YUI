import { afterEach, describe, expect, it, vi } from "vitest";
import { lastBackendEmotion } from "../../io/chat/last-emotion/last-emotion";
import type { ChatStreamEvent } from "../../io/chat/stream/chat-client";
import { createClientToolRegistry } from "../../io/chat/tools/client-tools";
import {
  CONFIG,
  deltaEvent,
  expressEvent,
  makeLogger,
  makeTurnOutput,
  turnOf,
  userEnv,
} from "../test-helpers";
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
      streamOpts: { tools: createClientToolRegistry([]) },
      endThinking: vi.fn(),
    });

    expect(result).toEqual({
      kind: "stream_error",
      message: "gone",
      status: 404,
      streamedAny: true,
    });
    expect(turnOutput.delta).toHaveBeenCalledWith("hello", {
      turn_id: "1",
      event_name: "user.text_submitted",
    });
    expect(turnOutput.abort).toHaveBeenCalledTimes(1);
  });

  describe("the last backend emotion", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    // Each row runs at its own time, far past the other's decay window.
    it.each([
      ["running", "angry", false, 1_000_000],
      ["stopped", "neutral", true, 9_000_000],
    ])("after an express cue in a %s turn is %s", async (_, expected, stopped, nowMs) => {
      vi.useFakeTimers({ toFake: ["Date"], now: nowMs });
      const external = new AbortController();
      if (stopped) external.abort();
      const attempt = createStreamAttempt(
        { config: CONFIG, turnOutput: makeTurnOutput() },
        makeLogger(),
        async function* () {
          yield expressEvent({ emotion_id: "angry" });
        },
      );

      await attempt.run({
        turn: turnOf(userEnv()),
        owner: "stream:1",
        externalSignal: external.signal,
        abort: vi.fn(),
        request: { input: [], signal: new AbortController().signal },
        streamOpts: { tools: createClientToolRegistry([]) },
        endThinking: vi.fn(),
      });

      expect(lastBackendEmotion(nowMs, 60_000)).toBe(expected);
    });
  });
});
