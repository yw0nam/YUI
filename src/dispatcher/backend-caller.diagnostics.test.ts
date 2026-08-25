/**
 * backend-caller.diagnostics.test.ts — diagnostics (failure classification, idle-gap watchdog, logging, transcript, response-id guard).
 *
 * Split from backend-caller.test.ts. Shared stateless fixtures live in ./test-helpers.ts; the
 * chat stream is injected per caller from the shared scripted fixture (BackendCallerDeps.stream).
 */

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { ToolStatus, Usage } from "../contract";
import type {
  ChatHistoryEntry,
  ChatHistoryItem,
  ChatHistoryStorage,
} from "../io/chat-history-store";
import { createChatHistoryStore } from "../io/chat-history-store";
import type { Logger } from "../logger";
import {
  type BackendCaller,
  createBackendCaller,
  PRE_SPEECH_TIMEOUT_MS,
  SPEECH_IDLE_TIMEOUT_MS,
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
  speechDoneEvent,
  toolStatusEvent,
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

  it("first event past SPEECH_IDLE_TIMEOUT_MS but inside the pre-speech budget → the turn survives and completes", async () => {
    script.events = [deltaEvent("a"), completedEvent({ speech_text: "a" })];
    script.gaps = [SPEECH_IDLE_TIMEOUT_MS + 1_000, 0];
    const p = caller.call(turnOf(userEnv()));
    await vi.advanceTimersByTimeAsync(SPEECH_IDLE_TIMEOUT_MS + 2_000);
    const res = await p;
    expect(res).toBe("ok");
  });

  it("no event at all within PRE_SPEECH_TIMEOUT_MS → aborts the request and drops network_stall", async () => {
    script.hangAt = 0;
    script.events = [];
    const p = caller.call(turnOf(userEnv()));
    await vi.advanceTimersByTimeAsync(PRE_SPEECH_TIMEOUT_MS);
    const res = await p;
    expect(res).toBe("network_stall");
    const [, request] = script.spy.mock.calls[0];
    expect((request.signal as AbortSignal).aborted).toBe(true);
  });

  it("stall after ≥1 speech_delta (mid-stream stall) → aborts, drops network_stall, tears down via turnOutput.abort", async () => {
    script.events = [deltaEvent("partial")];
    script.hangAt = 1;
    const p = caller.call(turnOf(userEnv()));
    await vi.advanceTimersByTimeAsync(SPEECH_IDLE_TIMEOUT_MS + 1_000);
    const res = await p;
    expect(res).toBe("network_stall");
    expect(turnOutput.abort).toHaveBeenCalledTimes(1);
    expect(turnOutput.end).not.toHaveBeenCalled();
  });

  it("resets on every speech_delta: many gaps under the deadline never time out, even though their sum exceeds it", async () => {
    const gap = SPEECH_IDLE_TIMEOUT_MS - 5_000;
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
    script.gaps = [SPEECH_IDLE_TIMEOUT_MS - 1_000];
    const p = caller.call(turnOf(userEnv()));
    await vi.advanceTimersByTimeAsync(SPEECH_IDLE_TIMEOUT_MS);
    const res = await p;
    expect(res).toBe("ok");
  });

  it("keepalive events during a long reasoning phase reset the watchdog — no stall even though the gap to first speech exceeds SPEECH_IDLE_TIMEOUT_MS", async () => {
    const gap = SPEECH_IDLE_TIMEOUT_MS - 5_000;
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

  it("keepalive → tool_status → 100s silence → no stall, stream continues once the next event arrives", async () => {
    script.events = [
      keepaliveEvent(),
      toolStatusEvent({ state: "running", tool_id: "t1" }),
      completedEvent({ speech_text: "done" }),
    ];
    script.gaps = [0, 0, 100_000]; // 100s of silence after tool_status, well under the pre-speech budget
    const p = caller.call(turnOf(userEnv()));
    await vi.advanceTimersByTimeAsync(101_000);
    const res = await p;
    expect(res).toBe("ok");
  });

  it("speech_delta → tool_status → 100s silence → no stall (a tool round after speech gets the long budget again)", async () => {
    script.events = [
      deltaEvent("partial"),
      toolStatusEvent({ state: "running", tool_id: "t1" }),
      completedEvent({ speech_text: "partial done" }),
    ];
    script.gaps = [0, 0, 100_000]; // 100s of silence after tool_status, well under the pre-speech budget
    const p = caller.call(turnOf(userEnv()));
    await vi.advanceTimersByTimeAsync(101_000);
    const res = await p;
    expect(res).toBe("ok");
  });

  it("speech_delta → speech_done → 46s silence → stall (speech_done still counts as speech)", async () => {
    script.events = [deltaEvent("a"), speechDoneEvent("a")];
    script.hangAt = 2;
    const p = caller.call(turnOf(userEnv()));
    await vi.advanceTimersByTimeAsync(SPEECH_IDLE_TIMEOUT_MS + 1_000);
    const res = await p;
    expect(res).toBe("network_stall");
    expect(logger.warn).toHaveBeenCalledWith(
      "network_stall",
      expect.objectContaining({ stage: "speech_idle_timeout", idle_ms: SPEECH_IDLE_TIMEOUT_MS }),
    );
  });

  it("speech_delta → speech_done → tool_status → 100s silence → no stall (a tool round after the reply finished streaming gets the long budget again)", async () => {
    script.events = [
      deltaEvent("partial"),
      speechDoneEvent("partial"),
      toolStatusEvent({ state: "running", tool_id: "t1" }),
      completedEvent({ speech_text: "partial done" }),
    ];
    script.gaps = [0, 0, 0, 100_000]; // 100s of silence after tool_status, well under the pre-speech budget
    const p = caller.call(turnOf(userEnv()));
    await vi.advanceTimersByTimeAsync(101_000);
    const res = await p;
    expect(res).toBe("ok");
  });

  it("logs logger.warn('network_stall', { stage: 'speech_idle_timeout', ... }) on a mid-stream gap after speech", async () => {
    script.events = [deltaEvent("partial")];
    script.hangAt = 1;
    const p = caller.call(turnOf(userEnv()));
    await vi.advanceTimersByTimeAsync(SPEECH_IDLE_TIMEOUT_MS + 1_000);
    await p;
    expect(logger.warn).toHaveBeenCalledWith(
      "network_stall",
      expect.objectContaining({ stage: "speech_idle_timeout", idle_ms: SPEECH_IDLE_TIMEOUT_MS }),
    );
  });

  it("logs logger.warn('network_stall', { stage: 'pre_speech_timeout', ... }) when no event ever lands", async () => {
    script.hangAt = 0;
    script.events = [];
    const p = caller.call(turnOf(userEnv()));
    await vi.advanceTimersByTimeAsync(PRE_SPEECH_TIMEOUT_MS);
    await p;
    expect(logger.warn).toHaveBeenCalledWith(
      "network_stall",
      expect.objectContaining({ stage: "pre_speech_timeout", idle_ms: PRE_SPEECH_TIMEOUT_MS }),
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
      // Never reset in these cases — the mid-flight reset has its own describe below.
      sessionToken: () => "session",
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

// ── session reset mid-flight (the finishing turn must not land in the new session) ──

describe("backend_caller — session reset while a turn is in flight", () => {
  /** Runs one turn whose speech callback fires `resetMidFlight`, same timing as the R2 race. */
  async function turnResetMidFlight(store: ReturnType<typeof createChatHistoryStore>) {
    caller = createBackendCaller({
      config: { ...CONFIG, chat_api: "chat_completions" },
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      transcript: store,
    });
    turnOutput.speak.mockImplementation(() => {
      store.startNewSession(100);
    });
    script.events = [completedEvent({ speech_text: "답변" }, "")];
    return caller.call(turnOf(userEnv("질문")));
  }

  it("reset lands mid-flight → the finishing turn contributes no entries to the new session", async () => {
    const store = createChatHistoryStore();
    store.append({ role: "user", text: "이전 질문", ts: 1 });
    store.append({ role: "assistant", text: "이전 답변", ts: 2 });

    await turnResetMidFlight(store);

    expect(store.entriesAfterLastBoundary()).toEqual([]);
  });

  it("reset lands mid-flight on an empty transcript (no boundary written) → new session stays empty", async () => {
    const store = createChatHistoryStore();

    await turnResetMidFlight(store);

    expect(store.entriesAfterLastBoundary()).toEqual([]);
  });

  it("reset from the other window lands mid-flight → its boundary survives, nothing appended", async () => {
    // Cross-window delivery is asynchronous, so this window's store is still unsynced when the
    // turn finishes: an unguarded append would also commit its stale array over the boundary.
    let saved: ChatHistoryItem[] | null = null;
    const storage: ChatHistoryStorage = {
      load: () => saved?.map((i) => ({ ...i })) ?? null,
      save: (s) => {
        saved = s;
      },
    };
    const store = createChatHistoryStore({ storage });
    store.append({ role: "user", text: "이전 질문", ts: 1 });
    const otherWindow = createChatHistoryStore({ storage });
    caller = createBackendCaller({
      config: { ...CONFIG, chat_api: "chat_completions" },
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      transcript: store,
    });
    turnOutput.speak.mockImplementation(() => {
      otherWindow.startNewSession(100);
    });
    script.events = [completedEvent({ speech_text: "답변" }, "")];
    await caller.call(turnOf(userEnv("질문")));

    expect(saved).toEqual([
      { role: "user", text: "이전 질문", ts: 1 },
      { kind: "boundary", ts: 100 },
    ]);
  });

  it("no reset → the finished turn is recorded as usual", async () => {
    const store = createChatHistoryStore();
    caller = createBackendCaller({
      config: { ...CONFIG, chat_api: "chat_completions" },
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      transcript: store,
    });
    script.events = [completedEvent({ speech_text: "답변" }, "")];
    await caller.call(turnOf(userEnv("질문")));

    expect(store.entriesAfterLastBoundary()).toEqual([
      expect.objectContaining({ role: "user", text: "질문" }),
      expect.objectContaining({ role: "assistant", text: "답변" }),
    ]);
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
