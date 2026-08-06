/**
 * backend-caller.chain-break.test.ts — 404 chain-break auto-recovery for previous_response_id.
 *
 * A backend HTTP 404 ("Previous response not found") on a turn carrying previous_response_id
 * and no rendered delta yet means the server lost that conversation's state. The caller clears
 * the stored id, notifies the UI, and retries once without previous_response_id.
 *
 * Split from backend-caller.test.ts. Shared stateless fixtures live in ./test-helpers.ts; the
 * chat stream is injected per caller from the shared scripted fixture (BackendCallerDeps.stream),
 * scripted here as a per-invocation queue since a retry issues a second, independently-scripted
 * streamChat() call within the same caller.call().
 */

import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { ExpressArgs, ToolStatus, Usage } from "../contract";
import type { Logger } from "../logger";
import { type BackendCaller, createBackendCaller } from "./backend-caller";
import {
  CONFIG,
  completedEvent,
  createScriptedStream,
  deltaEvent,
  makeLogger,
  userEnv,
} from "./test-helpers";

const script = createScriptedStream();

let applyDirective: ReturnType<typeof vi.fn>;
let speechSink: Mock<(text: string) => void>;
let speechDeltaSink: Mock<(text: string) => void>;
let onResponseId: Mock<(id: string) => void>;
let onResponseIdInvalid: Mock<() => void>;
let onChainReset: Mock<() => void>;
let getPreviousResponseId: Mock<() => string | undefined>;
let cueSink: Mock<(cue: ExpressArgs) => void>;
let toolStatusSink: Mock<(status: ToolStatus) => void>;
let speechEndSink: Mock<() => void>;
let speechInterruptSink: Mock<() => void>;
let speechAbortSink: Mock<() => void>;
let usageSink: Mock<(usage: Usage) => void>;
let caller: BackendCaller;
let logger: Logger;

function make404(previousResponseId: string | undefined): void {
  applyDirective = vi.fn();
  speechSink = vi.fn();
  speechDeltaSink = vi.fn();
  onResponseId = vi.fn();
  cueSink = vi.fn();
  toolStatusSink = vi.fn();
  speechEndSink = vi.fn();
  speechInterruptSink = vi.fn();
  speechAbortSink = vi.fn();
  usageSink = vi.fn();
  logger = makeLogger();
  // Mirror the real sessionStore wiring (main.ts): onResponseIdInvalid clears the stored id, so
  // a subsequent getPreviousResponseId() call reflects it — same as sessionStore.clear()/.get().
  let stored = previousResponseId;
  getPreviousResponseId = vi.fn(() => stored);
  onResponseIdInvalid = vi.fn(() => {
    stored = undefined;
  });
  onChainReset = vi.fn();
  caller = createBackendCaller({
    config: CONFIG,
    renderer: { applyDirective } as never,
    getApiKey: async () => "k",
    getFetch: async () => undefined,
    stream: script.stream,
    onSpeech: speechSink,
    onSpeechDelta: speechDeltaSink,
    onSpeechEnd: speechEndSink,
    onSpeechInterrupt: speechInterruptSink,
    onSpeechAbort: speechAbortSink,
    onCue: cueSink,
    onToolStatus: toolStatusSink,
    onUsage: usageSink,
    getPreviousResponseId,
    onResponseId,
    onResponseIdInvalid,
    onChainReset,
    logger,
  });
}

beforeEach(() => {
  script.reset();
  script.queue = [];
  make404("resp_dead");
});

describe("backend_caller — 404 chain-break recovery", () => {
  it("404 + previous_response_id present → clears state, retries once without it, persists the new id on success", async () => {
    script.queue = [
      [{ type: "error", message: "Previous response not found: resp_dead", status: 404 }],
      [completedEvent({ speech_text: "hi again" }, "resp_new")],
    ];
    const res = await caller.call(userEnv());

    expect(res).toEqual({ ok: true });
    expect(script.spy).toHaveBeenCalledTimes(2);
    expect(onResponseIdInvalid).toHaveBeenCalledTimes(1);

    // second attempt must drop previous_response_id entirely
    const [, firstRequest] = script.spy.mock.calls[0];
    const [, secondRequest] = script.spy.mock.calls[1];
    expect(firstRequest.previous_response_id).toBe("resp_dead");
    expect("previous_response_id" in secondRequest).toBe(false);

    expect(onResponseId).toHaveBeenCalledTimes(1);
    expect(onResponseId).toHaveBeenCalledWith("resp_new");

    expect(logger.warn).toHaveBeenCalledWith(
      "chain_break_404",
      expect.objectContaining({ status: 404, previous_response_id: "resp_dead" }),
    );
  });

  it("404 + no previous_response_id → no retry, network_drop, onResponseIdInvalid not called", async () => {
    make404(undefined);
    script.queue = [[{ type: "error", message: "not found", status: 404 }]];
    const res = await caller.call(userEnv());

    expect(res.ok).toBe(false);
    expect(res.drop_reason).toBe("network_drop");
    expect(script.spy).toHaveBeenCalledTimes(1);
    expect(onResponseIdInvalid).not.toHaveBeenCalled();
    expect(onChainReset).not.toHaveBeenCalled();
  });

  it("404 then retry also 404 → exactly 2 attempts, final network_drop, onResponseIdInvalid called once (no loop)", async () => {
    script.queue = [
      [{ type: "error", message: "Previous response not found: resp_dead", status: 404 }],
      [{ type: "error", message: "still not found", status: 404 }],
    ];
    const res = await caller.call(userEnv());

    expect(res.ok).toBe(false);
    expect(res.drop_reason).toBe("network_drop");
    expect(script.spy).toHaveBeenCalledTimes(2);
    expect(onResponseIdInvalid).toHaveBeenCalledTimes(1);
    expect(onChainReset).toHaveBeenCalledTimes(1);
  });

  it("404 after a speech delta already arrived → no retry, network_drop (existing drop behavior)", async () => {
    script.queue = [
      [
        deltaEvent("partial reply"),
        { type: "error", message: "Previous response not found: resp_dead", status: 404 },
      ],
    ];
    const res = await caller.call(userEnv());

    expect(res.ok).toBe(false);
    expect(res.drop_reason).toBe("network_drop");
    expect(script.spy).toHaveBeenCalledTimes(1);
    expect(onResponseIdInvalid).not.toHaveBeenCalled();
    expect(onChainReset).not.toHaveBeenCalled();
    expect(speechAbortSink).toHaveBeenCalledTimes(1);
  });

  it("on successful retry, the chain-reset notice callback is invoked exactly once", async () => {
    script.queue = [
      [{ type: "error", message: "Previous response not found: resp_dead", status: 404 }],
      [completedEvent({ speech_text: "hi again" }, "resp_new")],
    ];
    await caller.call(userEnv());
    expect(onChainReset).toHaveBeenCalledTimes(1);
  });

  it("401/403/500 classification is unaffected by chain-break handling (no retry, existing drop reasons)", async () => {
    script.queue = [[{ type: "error", message: "unauthorized", status: 401 }]];
    const res401 = await caller.call(userEnv());
    expect(res401.drop_reason).toBe("http_4xx_drop");

    make404("resp_dead");
    script.queue = [[{ type: "error", message: "forbidden", status: 403 }]];
    const res403 = await caller.call(userEnv());
    expect(res403.drop_reason).toBe("http_4xx_drop");

    make404("resp_dead");
    script.queue = [[{ type: "error", message: "server error", status: 500 }]];
    const res500 = await caller.call(userEnv());
    expect(res500.drop_reason).toBe("network_drop");

    expect(script.spy).toHaveBeenCalledTimes(3);
    expect(onResponseIdInvalid).not.toHaveBeenCalled();
  });

  it("network_drop log for a plain stream_error now carries status", async () => {
    make404(undefined);
    script.queue = [[{ type: "error", message: "server error", status: 500 }]];
    await caller.call(userEnv());
    expect(logger.warn).toHaveBeenCalledWith(
      "network_drop",
      expect.objectContaining({ stage: "stream_error", status: 500 }),
    );
  });
});
