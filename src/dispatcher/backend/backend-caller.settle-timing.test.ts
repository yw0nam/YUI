/**
 * backend-caller.settle-timing.test.ts — where the reply settle runs relative to microtasks queued
 * while the stream attempt closes.
 *
 * The attempt returns through one promise, so the settle runs one microtask after the attempt's
 * last verdict and flush. These cases pin that hop and that nothing re-judges the turn across it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONFIG,
  completedEvent,
  createScriptedStream,
  deltaEvent,
  makeTurnOutput,
  turnOf,
  userEnv,
} from "../test-helpers";
import { type BackendCaller, createBackendCaller } from "./backend-caller";

const script = createScriptedStream();
let turnOutput: ReturnType<typeof makeTurnOutput>;
let caller: BackendCaller;

beforeEach(() => {
  script.reset();
  turnOutput = makeTurnOutput();
  caller = createBackendCaller({
    config: CONFIG,
    renderer: { applyDirective: vi.fn() } as never,
    getApiKey: async () => "k",
    getFetch: async () => undefined,
    stream: script.stream,
    turnOutput,
  });
});

// A stream that ends on a held "[SIL" head makes the attempt's flush emit one last delta; the
// settle then signals the end of speech.
const HELD_HEAD = [deltaEvent("[SIL"), completedEvent({ speech_text: "[SIL" })];

describe("backend_caller — reply settle timing", () => {
  it("runs the settle exactly one microtask after the attempt's flush", async () => {
    const order: string[] = [];
    turnOutput.delta.mockImplementation(() => {
      order.push("delta");
      queueMicrotask(() => {
        order.push("first");
        queueMicrotask(() => order.push("second"));
      });
    });
    turnOutput.end.mockImplementation(() => order.push("end"));
    script.events = HELD_HEAD;

    await caller.call(turnOf(userEnv()));

    expect(order).toEqual(["delta", "first", "end", "second"]);
  });

  // Guards against an abort re-check after the attempt: a verdict already reached stays the outcome.
  it("an abort landing in that hop does not undo the verdict already reached", async () => {
    const ac = new AbortController();
    turnOutput.delta.mockImplementation(() => queueMicrotask(() => ac.abort()));
    script.events = HELD_HEAD;

    const res = await caller.call(turnOf(userEnv()), ac.signal);

    expect(res).toBe("ok");
    expect(turnOutput.end).toHaveBeenCalledTimes(1);
    expect(turnOutput.abort).not.toHaveBeenCalled();
  });

  it("builds a fresh options object for each stream attempt", async () => {
    let stored: string | undefined = "resp_dead";
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective: vi.fn() } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      getPreviousResponseId: () => stored,
      onResponseIdInvalid: () => {
        stored = undefined;
      },
    });
    script.queue = [
      [{ type: "error", message: "gone", status: 404 }],
      [completedEvent({ speech_text: "hi" })],
    ];

    await caller.call(turnOf(userEnv()));

    const [, , firstOpts] = script.spy.mock.calls[0];
    const [, , secondOpts] = script.spy.mock.calls[1];
    expect(secondOpts).toEqual(firstOpts);
    expect(secondOpts).not.toBe(firstOpts);
  });

  it("runs the 404 retry effects in order between the two attempts", async () => {
    const order: string[] = [];
    let stored: string | undefined = "resp_dead";
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective: vi.fn() } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: async function* (...args) {
        order.push(`stream:${"previous_response_id" in args[1] ? "with" : "without"}`);
        yield* script.stream(...args);
      } as typeof script.stream,
      turnOutput,
      getPreviousResponseId: () => stored,
      onResponseIdInvalid: () => {
        order.push("invalid");
        stored = undefined;
      },
      onChainReset: () => order.push("reset"),
    });
    script.queue = [
      [{ type: "error", message: "gone", status: 404 }],
      [completedEvent({ speech_text: "hi" })],
    ];

    await caller.call(turnOf(userEnv()));

    expect(order).toEqual(["stream:with", "invalid", "reset", "stream:without"]);
  });

  it("an abort landing during the 404 retry effects does not stop the next attempt from starting", async () => {
    const ac = new AbortController();
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective: vi.fn() } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      getPreviousResponseId: () => "resp_dead",
      onResponseIdInvalid: () => ac.abort(),
    });
    script.queue = [
      [{ type: "error", message: "gone", status: 404 }],
      [completedEvent({ speech_text: "hi" })],
    ];

    const res = await caller.call(turnOf(userEnv()), ac.signal);

    expect(script.spy).toHaveBeenCalledTimes(2);
    expect(res).toBe("superseded_by_user");
  });
});
