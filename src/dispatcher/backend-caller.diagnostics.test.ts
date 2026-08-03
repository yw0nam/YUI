/**
 * backend-caller.diagnostics.test.ts — diagnostics (failure classification, idle-gap watchdog, logging, transcript, response-id guard).
 *
 * Split from backend-caller.test.ts. Shared stateless fixtures live in ./test-helpers.ts;
 * the streamChat mock + mutable scripted-event state + sinks stay file-local (vitest vi.mock
 * is file-scoped and reads module-mutable state the test bodies reassign).
 */

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { ExpressArgs, ToolStatus, Usage } from "../contract";
import type { ChatStreamEvent } from "../io/chat-client";
import type { ChatHistoryEntry } from "../io/chat-history-store";
import type { Logger } from "../logger";
import type { BusEnvelope } from "./event-bus";
import {
  CONFIG,
  completedEvent,
  deltaEvent,
  keepaliveEvent,
  makeLogger,
  userEnv,
} from "./test-helpers";

let scriptedEvents: ChatStreamEvent[] = [];
let streamChatError: Error | null = null;
// per-event delay (ms) before yielding scriptedEvents[i], parallel array (default 0).
let scriptedGaps: number[] = [];
// index at which the stream hangs forever (never yields/throws again) — models a stall.
// 0 = hangs before the first event (no first byte / TTFT stall).
let hangAtIndex: number | null = null;
const streamChatSpy = vi.fn();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

vi.mock("../io/chat-client", () => ({
  async *streamChat(...args: unknown[]) {
    streamChatSpy(...args);
    for (let i = 0; i < scriptedEvents.length; i++) {
      if (hangAtIndex === i) await sleep(2 ** 31 - 1); // never resolves in practice
      const gap = scriptedGaps[i] ?? 0;
      if (gap > 0) await sleep(gap);
      yield scriptedEvents[i];
    }
    if (hangAtIndex === scriptedEvents.length) await sleep(2 ** 31 - 1);
    // yield scripted events first, then throw — models a stream that drops mid-flight.
    if (streamChatError) throw streamChatError;
  },
}));

import { type BackendCaller, createBackendCaller, IDLE_TIMEOUT_MS } from "./backend-caller";

let applyDirective: ReturnType<typeof vi.fn>;
let speechSink: Mock<(text: string) => void>;
let cueSink: Mock<(cue: ExpressArgs) => void>;
let toolStatusSink: Mock<(status: ToolStatus) => void>;
let speechDeltaSink: Mock<(text: string) => void>;
let speechEndSink: Mock<() => void>;
let speechInterruptSink: Mock<() => void>;
let speechAbortSink: Mock<() => void>;
let usageSink: Mock<(usage: Usage) => void>;
let caller: BackendCaller;
let logger: Logger;

beforeEach(() => {
  scriptedEvents = [];
  streamChatError = null;
  scriptedGaps = [];
  hangAtIndex = null;
  streamChatSpy.mockClear();
  applyDirective = vi.fn();
  speechSink = vi.fn();
  cueSink = vi.fn();
  toolStatusSink = vi.fn();
  speechDeltaSink = vi.fn();
  speechEndSink = vi.fn();
  speechInterruptSink = vi.fn();
  speechAbortSink = vi.fn();
  usageSink = vi.fn();
  logger = makeLogger();
  caller = createBackendCaller({
    config: CONFIG,
    renderer: { applyDirective } as never,
    getApiKey: async () => "k",
    getFetch: async () => undefined,
    onSpeech: speechSink,
    onCue: cueSink,
    onToolStatus: toolStatusSink,
    onSpeechDelta: speechDeltaSink,
    onSpeechEnd: speechEndSink,
    onSpeechInterrupt: speechInterruptSink,
    onSpeechAbort: speechAbortSink,
    onUsage: usageSink,
    logger,
  });
});

describe("backend_caller — failure classification (§7.3)", () => {
  it("no completed event → parse_error drop", async () => {
    scriptedEvents = [{ type: "speech_delta", text: "x" }];
    const res = await caller.call(userEnv());
    expect(res.ok).toBe(false);
    expect(res.drop_reason).toBe("parse_error");
    expect(applyDirective).not.toHaveBeenCalled();
  });

  it("an error event surfaces as network_drop and applies nothing", async () => {
    scriptedEvents = [{ type: "error", message: "401 unauthorized" }];
    const res = await caller.call(userEnv());
    expect(res.ok).toBe(false);
    expect(res.drop_reason).toBe("network_drop");
  });

  it("an error event carrying status:401 surfaces as http_4xx_drop (auth-ish)", async () => {
    scriptedEvents = [{ type: "error", message: "401 Incorrect API key provided", status: 401 }];
    const res = await caller.call(userEnv());
    expect(res.ok).toBe(false);
    expect(res.drop_reason).toBe("http_4xx_drop");
  });

  it("an error event carrying status:403 surfaces as http_4xx_drop (auth-ish)", async () => {
    scriptedEvents = [{ type: "error", message: "403 Forbidden", status: 403 }];
    const res = await caller.call(userEnv());
    expect(res.ok).toBe(false);
    expect(res.drop_reason).toBe("http_4xx_drop");
  });

  it("an error event carrying an unrelated status (e.g. 500) stays network_drop", async () => {
    scriptedEvents = [{ type: "error", message: "500 internal error", status: 500 }];
    const res = await caller.call(userEnv());
    expect(res.ok).toBe(false);
    expect(res.drop_reason).toBe("network_drop");
  });

  it("a thrown stream rejects to network_drop (not a crash)", async () => {
    streamChatError = new Error("boom");
    const res = await caller.call(userEnv());
    expect(res.ok).toBe(false);
    expect(res.drop_reason).toBe("network_drop");
  });

  it("an already-aborted external signal short-circuits without calling streamChat", async () => {
    const ac = new AbortController();
    ac.abort();
    const res = await caller.call(userEnv(), ac.signal);
    expect(res.ok).toBe(false);
    expect(streamChatSpy).not.toHaveBeenCalled();
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

  it("no first byte within IDLE_TIMEOUT_MS (TTFT stall) → aborts the request and drops network_stall", async () => {
    hangAtIndex = 0;
    scriptedEvents = [];
    const p = caller.call(userEnv());
    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS);
    const res = await p;
    expect(res.ok).toBe(false);
    expect(res.drop_reason).toBe("network_stall");
    const [, request] = streamChatSpy.mock.calls[0];
    expect((request.signal as AbortSignal).aborted).toBe(true);
  });

  it("stall after ≥1 delta (mid-stream stall) → aborts, drops network_stall, tears down via onSpeechAbort", async () => {
    scriptedEvents = [deltaEvent("partial")];
    hangAtIndex = 1;
    const p = caller.call(userEnv());
    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS);
    const res = await p;
    expect(res.ok).toBe(false);
    expect(res.drop_reason).toBe("network_stall");
    expect(speechAbortSink).toHaveBeenCalledTimes(1);
    expect(speechEndSink).not.toHaveBeenCalled();
  });

  it("resets on every event: many gaps under the deadline never time out, even though their sum exceeds it", async () => {
    const gap = IDLE_TIMEOUT_MS - 5_000;
    scriptedEvents = [
      deltaEvent("a"),
      deltaEvent("b"),
      deltaEvent("c"),
      completedEvent({ speech_text: "abc" }),
    ];
    scriptedGaps = [gap, gap, gap, 0]; // sum ≈ 3x the deadline
    const p = caller.call(userEnv());
    await vi.advanceTimersByTimeAsync(gap * 3 + 1_000);
    const res = await p;
    expect(res.ok).toBe(true);
    expect(res.drop_reason).toBeUndefined();
  });

  it("a single gap just under the deadline still completes normally", async () => {
    scriptedEvents = [deltaEvent("a"), completedEvent({ speech_text: "a" })];
    scriptedGaps = [IDLE_TIMEOUT_MS - 1_000];
    const p = caller.call(userEnv());
    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS);
    const res = await p;
    expect(res.ok).toBe(true);
  });

  it("keepalive events during a long reasoning phase reset the watchdog — no idle_timeout even though the gap to first speech exceeds the deadline", async () => {
    const gap = IDLE_TIMEOUT_MS - 5_000;
    scriptedEvents = [
      keepaliveEvent(),
      keepaliveEvent(),
      keepaliveEvent(),
      deltaEvent("a"),
      completedEvent({ speech_text: "a" }),
    ];
    scriptedGaps = [gap, gap, gap, 0, 0]; // sum of gaps ≈ 3x the deadline
    const p = caller.call(userEnv());
    await vi.advanceTimersByTimeAsync(gap * 3 + 1_000);
    const res = await p;
    expect(res.ok).toBe(true);
    expect(res.drop_reason).toBeUndefined();
  });

  it("logs logger.warn('network_stall', { stage: 'idle_timeout', ... }) on expiry", async () => {
    hangAtIndex = 0;
    scriptedEvents = [];
    const p = caller.call(userEnv());
    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS);
    await p;
    expect(logger.warn).toHaveBeenCalledWith(
      "network_stall",
      expect.objectContaining({ stage: "idle_timeout" }),
    );
  });
});

// ── streaming TTS: speech_delta → onSpeechDelta / onSpeechEnd / onSpeechInterrupt ─

describe("backend_caller — structured logging", () => {
  it("no completed event (parse_error) → logger.warn('parse_error', ...)", async () => {
    scriptedEvents = [];
    await caller.call(userEnv());
    expect(logger.warn).toHaveBeenCalledWith(
      "parse_error",
      expect.objectContaining({ event_name: expect.any(String) }),
    );
  });

  it("error stream event (network_drop) → logger.warn with network_drop context", async () => {
    scriptedEvents = [{ type: "error", message: "401 unauthorized" }];
    await caller.call(userEnv());
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("network_drop"),
      expect.anything(),
    );
  });

  it("thrown stream (network_drop) → logger.warn with network_drop context", async () => {
    streamChatError = new Error("boom");
    await caller.call(userEnv());
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
      onSpeech: speechSink,
      logger,
    });
    scriptedEvents = [completedEvent({ speech_text: "안녕", emotion: { id: "happy" } })];
    const res = await caller.call(userEnv());
    // turn must still succeed despite renderer error
    expect(res.ok).toBe(true);
    expect(logger.error).toHaveBeenCalledWith(
      "dispatch_to_renderer.error",
      expect.objectContaining({ error: expect.any(String) }),
    );
  });

  it("empty speech_text → logger.info('empty_speech', { trigger })", async () => {
    scriptedEvents = [completedEvent({ speech_text: "", emotion: { id: "thinking" } })];
    await caller.call(userEnv());
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
      get: () => entries,
    };
  }

  it("successful user-triggered turn (Responses mode) → user + assistant appended in order", async () => {
    const transcript = makeTranscript();
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      transcript,
    });
    scriptedEvents = [completedEvent({ speech_text: "안녕!" })];
    await caller.call(userEnv("안녕"));
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
      onSpeech: speechSink,
      transcript,
    });
    scriptedEvents = [completedEvent({ speech_text: "네" }, "")];
    await caller.call(userEnv("질문"));
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
      onSpeech: speechSink,
      transcript,
    });
    scriptedEvents = [completedEvent({ speech_text: "좋은 아침!" })];
    const env: BusEnvelope = {
      seq_id: 41,
      source: "timer_scheduler",
      event_name: "proactive.cowork",
      ts: 1_717_000_000_000,
      hint_tier: 2,
      payload: {},
    };
    await caller.call(env);
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
      onSpeech: speechSink,
      transcript,
    });
    scriptedEvents = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv("조용히"));
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
      onSpeech: speechSink,
      transcript,
    });
    scriptedEvents = [{ type: "error", message: "boom" }];
    await caller.call(userEnv("안녕"));
    expect(transcript.append).not.toHaveBeenCalled();
  });

  it("parse_error turn (no completed event) → nothing appended", async () => {
    const transcript = makeTranscript();
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      transcript,
    });
    scriptedEvents = [];
    await caller.call(userEnv("안녕"));
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
      onSpeech: speechSink,
      transcript,
    });
    scriptedEvents = [completedEvent({ speech_text: "hi" })];
    await caller.call(userEnv("안녕"), ac.signal);
    expect(transcript.append).not.toHaveBeenCalled();
  });

  it("no transcript dep → does not throw", async () => {
    scriptedEvents = [completedEvent({ speech_text: "hi" })];
    const res = await caller.call(userEnv("안녕"));
    expect(res.ok).toBe(true);
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
      onSpeech: speechSink,
      onResponseId,
    });
    scriptedEvents = [completedEvent({ speech_text: "hi" }, "")];
    await caller.call(userEnv());
    expect(onResponseId).not.toHaveBeenCalled();
  });

  it("CC mode → previous_response_id snapshot/persist logic skipped entirely", async () => {
    const onResponseId = vi.fn();
    caller = createBackendCaller({
      config: { ...CONFIG, chat_api: "chat_completions" },
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      getPreviousResponseId: () => "resp_prev",
      onResponseId,
    });
    scriptedEvents = [completedEvent({ speech_text: "hi" }, "")];
    await caller.call(userEnv());
    const [, request] = streamChatSpy.mock.calls[0];
    expect("previous_response_id" in request).toBe(false);
    expect(onResponseId).not.toHaveBeenCalled();
  });
});
