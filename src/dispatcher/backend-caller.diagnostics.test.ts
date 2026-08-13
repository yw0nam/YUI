/**
 * backend-caller.diagnostics.test.ts — diagnostics (failure classification, idle-gap watchdog, logging, transcript, response-id guard).
 *
 * Split from backend-caller.test.ts. Shared stateless fixtures live in ./test-helpers.ts; the
 * chat stream is injected per caller from the shared scripted fixture (BackendCallerDeps.stream).
 */

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { ToolStatus, Usage } from "../contract";
import type { ChatHistoryEntry } from "../io/chat-history-store";
import type { Logger } from "../logger";
import {
  type BackendCaller,
  createBackendCaller,
  FIRST_EVENT_TIMEOUT_MS,
  IDLE_TIMEOUT_MS,
} from "./backend-caller";
import type { BusEnvelope } from "./event-bus";
import {
  CONFIG,
  completedEvent,
  createScriptedStream,
  deltaEvent,
  keepaliveEvent,
  makeLogger,
  makeTurnOutput,
  turnOf,
  userEnv,
} from "./test-helpers";

const script = createScriptedStream();
let applyDirective: ReturnType<typeof vi.fn>;
let turnOutput: ReturnType<typeof makeTurnOutput>;
let toolStatusSink: Mock<(status: ToolStatus) => void>;
let usageSink: Mock<(usage: Usage) => void>;
let caller: BackendCaller;
let logger: Logger;

beforeEach(() => {
  script.reset();
  applyDirective = vi.fn();
  turnOutput = makeTurnOutput();
  toolStatusSink = vi.fn();
  usageSink = vi.fn();
  logger = makeLogger();
  caller = createBackendCaller({
    config: CONFIG,
    renderer: { applyDirective } as never,
    getApiKey: async () => "k",
    getFetch: async () => undefined,
    stream: script.stream,
    turnOutput,
    onToolStatus: toolStatusSink,
    onUsage: usageSink,
    logger,
  });
});

describe("backend_caller — failure classification (§7.3)", () => {
  it("no completed event → parse_error drop", async () => {
    script.events = [{ type: "speech_delta", text: "x" }];
    const res = await caller.call(turnOf(userEnv()));
    expect(res).toBe("parse_error");
    expect(applyDirective).not.toHaveBeenCalled();
  });

  it("an error event surfaces as network_drop and applies nothing", async () => {
    script.events = [{ type: "error", message: "401 unauthorized" }];
    const res = await caller.call(turnOf(userEnv()));
    expect(res).toBe("network_drop");
  });

  it("an error event carrying status:401 surfaces as http_4xx_drop (auth-ish)", async () => {
    script.events = [{ type: "error", message: "401 Incorrect API key provided", status: 401 }];
    const res = await caller.call(turnOf(userEnv()));
    expect(res).toBe("http_4xx_drop");
  });

  it("an error event carrying status:403 surfaces as http_4xx_drop (auth-ish)", async () => {
    script.events = [{ type: "error", message: "403 Forbidden", status: 403 }];
    const res = await caller.call(turnOf(userEnv()));
    expect(res).toBe("http_4xx_drop");
  });

  it("an error event carrying an unrelated status (e.g. 500) stays network_drop", async () => {
    script.events = [{ type: "error", message: "500 internal error", status: 500 }];
    const res = await caller.call(turnOf(userEnv()));
    expect(res).toBe("network_drop");
  });

  it("a thrown stream rejects to network_drop (not a crash)", async () => {
    script.error = new Error("boom");
    const res = await caller.call(turnOf(userEnv()));
    expect(res).toBe("network_drop");
  });

  it("an already-aborted external signal short-circuits without calling streamChat", async () => {
    const ac = new AbortController();
    ac.abort();
    const res = await caller.call(turnOf(userEnv()), ac.signal);
    expect(res).toBe("superseded_by_user");
    expect(script.spy).not.toHaveBeenCalled();
  });
});

// ── idle-gap watchdog: aborts a stalled call, never a slow-but-progressing one ──

describe("backend_caller — idle-gap watchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("first event past IDLE_TIMEOUT_MS but inside the first-event budget → the turn survives and completes", async () => {
    script.events = [deltaEvent("a"), completedEvent({ speech_text: "a" })];
    script.gaps = [IDLE_TIMEOUT_MS + 1_000, 0];
    const p = caller.call(turnOf(userEnv()));
    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS + 2_000);
    const res = await p;
    expect(res).toBe("ok");
  });

  it("no first event within FIRST_EVENT_TIMEOUT_MS → aborts the request and drops network_stall", async () => {
    script.hangAt = 0;
    script.events = [];
    const p = caller.call(turnOf(userEnv()));
    await vi.advanceTimersByTimeAsync(FIRST_EVENT_TIMEOUT_MS);
    const res = await p;
    expect(res).toBe("network_stall");
    const [, request] = script.spy.mock.calls[0];
    expect((request.signal as AbortSignal).aborted).toBe(true);
  });

  it("stall after ≥1 delta (mid-stream stall) → aborts, drops network_stall, tears down via turnOutput.abort", async () => {
    script.events = [deltaEvent("partial")];
    script.hangAt = 1;
    const p = caller.call(turnOf(userEnv()));
    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS + 1_000);
    const res = await p;
    expect(res).toBe("network_stall");
    expect(turnOutput.abort).toHaveBeenCalledTimes(1);
    expect(turnOutput.end).not.toHaveBeenCalled();
  });

  it("resets on every event: many gaps under the deadline never time out, even though their sum exceeds it", async () => {
    const gap = IDLE_TIMEOUT_MS - 5_000;
    script.events = [
      deltaEvent("a"),
      deltaEvent("b"),
      deltaEvent("c"),
      completedEvent({ speech_text: "abc" }),
    ];
    script.gaps = [gap, gap, gap, 0]; // sum ≈ 3x the deadline
    const p = caller.call(turnOf(userEnv()));
    await vi.advanceTimersByTimeAsync(gap * 3 + 1_000);
    const res = await p;
    expect(res).toBe("ok");
  });

  it("a single gap just under the deadline still completes normally", async () => {
    script.events = [deltaEvent("a"), completedEvent({ speech_text: "a" })];
    script.gaps = [IDLE_TIMEOUT_MS - 1_000];
    const p = caller.call(turnOf(userEnv()));
    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS);
    const res = await p;
    expect(res).toBe("ok");
  });

  it("keepalive events during a long reasoning phase reset the watchdog — no idle_timeout even though the gap to first speech exceeds the deadline", async () => {
    const gap = IDLE_TIMEOUT_MS - 5_000;
    script.events = [
      keepaliveEvent(),
      keepaliveEvent(),
      keepaliveEvent(),
      deltaEvent("a"),
      completedEvent({ speech_text: "a" }),
    ];
    script.gaps = [gap, gap, gap, 0, 0]; // sum of gaps ≈ 3x the deadline
    const p = caller.call(turnOf(userEnv()));
    await vi.advanceTimersByTimeAsync(gap * 3 + 1_000);
    const res = await p;
    expect(res).toBe("ok");
  });

  it("logs logger.warn('network_stall', { stage: 'idle_timeout', ... }) on a mid-stream gap", async () => {
    script.events = [deltaEvent("partial")];
    script.hangAt = 1;
    const p = caller.call(turnOf(userEnv()));
    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS + 1_000);
    await p;
    expect(logger.warn).toHaveBeenCalledWith(
      "network_stall",
      expect.objectContaining({ stage: "idle_timeout", idle_ms: IDLE_TIMEOUT_MS }),
    );
  });

  it("logs logger.warn('network_stall', { stage: 'first_event_timeout', ... }) when no event ever lands", async () => {
    script.hangAt = 0;
    script.events = [];
    const p = caller.call(turnOf(userEnv()));
    await vi.advanceTimersByTimeAsync(FIRST_EVENT_TIMEOUT_MS);
    await p;
    expect(logger.warn).toHaveBeenCalledWith(
      "network_stall",
      expect.objectContaining({ stage: "first_event_timeout", idle_ms: FIRST_EVENT_TIMEOUT_MS }),
    );
  });
});

// ── streaming TTS: speech_delta → turnOutput.delta / .end / .interrupt ─

describe("backend_caller — structured logging", () => {
  it("no completed event (parse_error) → logger.warn('parse_error', ...)", async () => {
    script.events = [];
    await caller.call(turnOf(userEnv()));
    expect(logger.warn).toHaveBeenCalledWith(
      "parse_error",
      expect.objectContaining({ event_name: expect.any(String) }),
    );
  });

  it("error stream event (network_drop) → logger.warn with network_drop context", async () => {
    script.events = [{ type: "error", message: "401 unauthorized" }];
    await caller.call(turnOf(userEnv()));
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("network_drop"),
      expect.anything(),
    );
  });

  it("thrown stream (network_drop) → logger.warn with network_drop context", async () => {
    script.error = new Error("boom");
    await caller.call(turnOf(userEnv()));
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("network_drop"),
      expect.anything(),
    );
  });

  it("applyDirective throws → logger.error('dispatch_to_renderer.error', ...)", async () => {
    applyDirective = vi.fn(() => {
      throw new Error("renderer boom");
    });
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      logger,
    });
    script.events = [completedEvent({ speech_text: "안녕", emotion: { id: "happy" } })];
    const res = await caller.call(turnOf(userEnv()));
    // turn must still succeed despite renderer error
    expect(res).toBe("ok");
    expect(logger.error).toHaveBeenCalledWith(
      "dispatch_to_renderer.error",
      expect.objectContaining({ error: expect.any(String) }),
    );
  });

  it("empty speech_text → logger.info('empty_speech', { trigger })", async () => {
    script.events = [completedEvent({ speech_text: "", emotion: { id: "thinking" } })];
    await caller.call(turnOf(userEnv()));
    expect(logger.info).toHaveBeenCalledWith(
      "empty_speech",
      expect.objectContaining({ trigger: expect.anything() }),
    );
  });
});

// ── previous_response_id threading (OpenAI Responses conversation state) ────────

describe("backend_caller — transcript recording", () => {
  function makeTranscript() {
    const entries: ChatHistoryEntry[] = [];
    return {
      append: vi.fn((e: ChatHistoryEntry) => entries.push(e)),
      entriesAfterLastBoundary: () => entries,
    };
  }

  it("successful user-triggered turn (Responses mode) → user + assistant appended in order", async () => {
    const transcript = makeTranscript();
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      transcript,
    });
    script.events = [completedEvent({ speech_text: "안녕!" })];
    await caller.call(turnOf(userEnv("안녕")));
    expect(transcript.append).toHaveBeenCalledTimes(2);
    expect(transcript.append).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ role: "user", text: "안녕" }),
    );
    expect(transcript.append).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ role: "assistant", text: "안녕!" }),
    );
  });

  it("successful user-triggered turn (CC mode) → user + assistant appended too", async () => {
    const transcript = makeTranscript();
    caller = createBackendCaller({
      config: { ...CONFIG, chat_api: "chat_completions" },
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      transcript,
    });
    script.events = [completedEvent({ speech_text: "네" }, "")];
    await caller.call(turnOf(userEnv("질문")));
    expect(transcript.append).toHaveBeenCalledTimes(2);
    expect(transcript.append).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ role: "user", text: "질문" }),
    );
    expect(transcript.append).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ role: "assistant", text: "네" }),
    );
  });

  it("proactive turn (no user_text) → assistant appended only", async () => {
    const transcript = makeTranscript();
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      transcript,
    });
    script.events = [completedEvent({ speech_text: "좋은 아침!" })];
    const env: BusEnvelope = {
      seq_id: 41,
      source: "timer_scheduler",
      event_name: "proactive.cowork",
      ts: 1_717_000_000_000,
      hint_tier: 2,
      payload: {},
    };
    await caller.call(turnOf(env));
    expect(transcript.append).toHaveBeenCalledTimes(1);
    expect(transcript.append).toHaveBeenCalledWith(
      expect.objectContaining({ role: "assistant", text: "좋은 아침!" }),
    );
  });

  it("empty speech_text → user appended, assistant NOT appended", async () => {
    const transcript = makeTranscript();
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      transcript,
    });
    script.events = [completedEvent({ speech_text: "" })];
    await caller.call(turnOf(userEnv("조용히")));
    expect(transcript.append).toHaveBeenCalledTimes(1);
    expect(transcript.append).toHaveBeenCalledWith(
      expect.objectContaining({ role: "user", text: "조용히" }),
    );
  });

  it("error event turn → nothing appended", async () => {
    const transcript = makeTranscript();
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      transcript,
    });
    script.events = [{ type: "error", message: "boom" }];
    await caller.call(turnOf(userEnv("안녕")));
    expect(transcript.append).not.toHaveBeenCalled();
  });

  it("parse_error turn (no completed event) → nothing appended", async () => {
    const transcript = makeTranscript();
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      transcript,
    });
    script.events = [];
    await caller.call(turnOf(userEnv("안녕")));
    expect(transcript.append).not.toHaveBeenCalled();
  });

  it("aborted turn → nothing appended", async () => {
    const transcript = makeTranscript();
    const ac = new AbortController();
    ac.abort();
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      transcript,
    });
    script.events = [completedEvent({ speech_text: "hi" })];
    await caller.call(turnOf(userEnv("안녕")), ac.signal);
    expect(transcript.append).not.toHaveBeenCalled();
  });

  it("no transcript dep → does not throw", async () => {
    script.events = [completedEvent({ speech_text: "hi" })];
    const res = await caller.call(turnOf(userEnv("안녕")));
    expect(res).toBe("ok");
  });
});

// ── onResponseId empty-string guard (CC completed events carry responseId:"") ──

describe("backend_caller — onResponseId empty-string guard", () => {
  it("responseId '' (Responses mode) → onResponseId NOT called", async () => {
    const onResponseId = vi.fn();
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      onResponseId,
    });
    script.events = [completedEvent({ speech_text: "hi" }, "")];
    await caller.call(turnOf(userEnv()));
    expect(onResponseId).not.toHaveBeenCalled();
  });

  it("CC mode → previous_response_id snapshot/persist logic skipped entirely", async () => {
    const onResponseId = vi.fn();
    caller = createBackendCaller({
      config: { ...CONFIG, chat_api: "chat_completions" },
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      getPreviousResponseId: () => "resp_prev",
      onResponseId,
    });
    script.events = [completedEvent({ speech_text: "hi" }, "")];
    await caller.call(turnOf(userEnv()));
    const [, request] = script.spy.mock.calls[0];
    expect("previous_response_id" in request).toBe(false);
    expect(onResponseId).not.toHaveBeenCalled();
  });
});
