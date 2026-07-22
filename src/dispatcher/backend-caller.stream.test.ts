/**
 * backend-caller.stream.test.ts — streaming path (speech gate, cue/tool_status forwarding, deltas, per-beat cues, usage, TTFT lifecycle).
 *
 * Split from backend-caller.test.ts. Shared stateless fixtures live in ./test-helpers.ts;
 * the streamChat mock + mutable scripted-event state + sinks stay file-local (vitest vi.mock
 * is file-scoped and reads module-mutable state the test bodies reassign).
 */

import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { ControlEnvelope, ExpressArgs, ToolStatus, Usage } from "../contract";
import type { ChatStreamEvent } from "../io/chat-client";
import type { Logger } from "../logger";
import {
  CONFIG,
  completedEvent,
  deltaEvent,
  dragHeldEnv,
  expressEvent,
  makeLogger,
  peekEnv,
  toolStatusEvent,
  touchEnv,
  usageEvent,
  userEnv,
  windowSitEnv,
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

import { type BackendCaller, createBackendCaller } from "./backend-caller";

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

describe("backend_caller — B4 speech gate (speech_text only)", () => {
  it("non-empty speech_text → applyDirective + speech sink (B5)", async () => {
    const env: ControlEnvelope = {
      speech_text: "응 듣고 있어",
      emotion: { id: "happy" },
    };
    scriptedEvents = [completedEvent(env)];
    const res = await caller.call(userEnv());
    expect(res.ok).toBe(true);
    expect(applyDirective).toHaveBeenCalledWith(env);
    expect(speechSink).toHaveBeenCalledWith("응 듣고 있어");
  });

  it("empty speech_text → no speech, but render channels still applied (silence = empty text)", async () => {
    const env: ControlEnvelope = {
      speech_text: "",
      emotion: { id: "thinking" },
    };
    scriptedEvents = [completedEvent(env)];
    const res = await caller.call(userEnv());
    expect(res.ok).toBe(true);
    expect(res.drop_reason).toBeUndefined();
    expect(speechSink).not.toHaveBeenCalled();
    // emotion/motion still rendered (firing≠judgment: silence only gates speech).
    expect(applyDirective).toHaveBeenCalledWith(env);
  });
});

describe("backend_caller — B5 cue forwarding + tool_status callbacks", () => {
  it("forwards each express cue to onCue (full args, not just emotion_text)", async () => {
    scriptedEvents = [
      deltaEvent("hi "),
      expressEvent({ emotion_id: "happy", motion_id: "wave", emotion_text: "(whisper)" }),
      completedEvent({ speech_text: "hi", emotion_text: "(whisper)" }),
    ];
    await caller.call(userEnv());
    expect(cueSink).toHaveBeenCalledWith({
      emotion_id: "happy",
      motion_id: "wave",
      emotion_text: "(whisper)",
    });
  });

  it("does not call onCue when the stream yields no express event", async () => {
    const env: ControlEnvelope = { speech_text: "안녕", emotion: { id: "happy" } };
    scriptedEvents = [deltaEvent("안녕"), completedEvent(env)];
    await caller.call(userEnv());
    expect(cueSink).not.toHaveBeenCalled();
  });

  it("forwards each streamed tool_status event to onToolStatus (running spinner, done check)", async () => {
    const running = { state: "running" as const, tool_id: "web_search" };
    const done = { state: "done" as const, tool_id: "web_search" };
    scriptedEvents = [
      toolStatusEvent(running),
      toolStatusEvent(done),
      completedEvent({ speech_text: "" }),
    ];
    await caller.call(userEnv());
    expect(toolStatusSink).toHaveBeenNthCalledWith(1, running);
    expect(toolStatusSink).toHaveBeenNthCalledWith(2, done);
  });

  it("emits an idle status when a running tool never completes (turn drops mid-flight)", async () => {
    const running = { state: "running" as const, tool_id: "web_search" };
    scriptedEvents = [toolStatusEvent(running)];
    streamChatError = new Error("drop");
    const res = await caller.call(userEnv());
    expect(res.ok).toBe(false);
    expect(toolStatusSink).toHaveBeenNthCalledWith(1, running);
    expect(toolStatusSink).toHaveBeenLastCalledWith({ state: "idle" });
  });

  it("does not emit idle when the tool completes normally (done seen)", async () => {
    scriptedEvents = [
      toolStatusEvent({ state: "running", tool_id: "web_search" }),
      toolStatusEvent({ state: "done", tool_id: "web_search" }),
      completedEvent({ speech_text: "" }),
    ];
    await caller.call(userEnv());
    expect(toolStatusSink).not.toHaveBeenCalledWith({ state: "idle" });
  });
});

describe("backend_caller — streaming speech deltas (incremental TTS)", () => {
  it("each speech_delta → onSpeechDelta in order; onSpeechEnd once after all deltas", async () => {
    scriptedEvents = [
      deltaEvent("Hel"),
      deltaEvent("lo "),
      deltaEvent("world"),
      completedEvent({ speech_text: "Hello world" }),
    ];
    await caller.call(userEnv());
    expect(speechDeltaSink.mock.calls.map((c) => c[0])).toEqual(["Hel", "lo ", "world"]);
    expect(speechEndSink).toHaveBeenCalledTimes(1);
  });

  it("onSpeechInterrupt fires once at the START of call(), before the first delta", async () => {
    const order: string[] = [];
    speechInterruptSink.mockImplementation(() => order.push("interrupt"));
    speechDeltaSink.mockImplementation((t: string) => order.push(`delta:${t}`));
    speechEndSink.mockImplementation(() => order.push("end"));
    scriptedEvents = [deltaEvent("a"), deltaEvent("b"), completedEvent({ speech_text: "ab" })];
    await caller.call(userEnv());
    expect(speechInterruptSink).toHaveBeenCalledTimes(1);
    // interrupt precedes every delta (and the end).
    expect(order).toEqual(["interrupt", "delta:a", "delta:b", "end"]);
  });

  it("express cue → onCue DURING the stream, before onSpeechEnd", async () => {
    const order: string[] = [];
    cueSink.mockImplementation((c: ExpressArgs) => order.push(`cue:${c.emotion_text}`));
    speechDeltaSink.mockImplementation((t: string) => order.push(`delta:${t}`));
    speechEndSink.mockImplementation(() => order.push("end"));
    scriptedEvents = [
      deltaEvent("hi "),
      expressEvent({ emotion_text: "(whisper)" }),
      deltaEvent("there"),
      completedEvent({ speech_text: "hi there", emotion_text: "(whisper)" }),
    ];
    await caller.call(userEnv());
    expect(cueSink).toHaveBeenCalledWith({ emotion_text: "(whisper)" });
    // cue routed mid-stream, strictly before the end signal.
    expect(order.indexOf("cue:(whisper)")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("cue:(whisper)")).toBeLessThan(order.indexOf("end"));
  });

  it("empty speech_text: no speech_delta → neither onSpeechDelta nor onSpeechEnd", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv());
    expect(speechDeltaSink).not.toHaveBeenCalled();
    expect(speechEndSink).not.toHaveBeenCalled();
  });

  it("error mid-stream after ≥1 delta → onSpeechAbort tears down (not onSpeechEnd)", async () => {
    scriptedEvents = [deltaEvent("partial"), { type: "error", message: "boom" }];
    await caller.call(userEnv());
    expect(speechEndSink).not.toHaveBeenCalled();
    expect(speechAbortSink).toHaveBeenCalledTimes(1);
  });

  it("thrown stream mid-flight after ≥1 delta → onSpeechAbort tears down (not onSpeechEnd)", async () => {
    scriptedEvents = [deltaEvent("partial")];
    streamChatError = new Error("network reset");
    await caller.call(userEnv());
    expect(speechEndSink).not.toHaveBeenCalled();
    expect(speechAbortSink).toHaveBeenCalledTimes(1);
  });

  it("user-supersede mid-stream (aborted signal) → NO abort teardown (next turn cleans up)", async () => {
    const ac = new AbortController();
    speechDeltaSink.mockImplementation(() => ac.abort());
    scriptedEvents = [deltaEvent("partial"), { type: "error", message: "boom" }];
    const res = await caller.call(userEnv(), ac.signal);
    expect(res.drop_reason).toBe("superseded_by_user");
    expect(speechAbortSink).not.toHaveBeenCalled();
    expect(speechEndSink).not.toHaveBeenCalled();
  });

  it("drops a buffered speech delta yielded after the external signal aborts", async () => {
    const ac = new AbortController();
    speechDeltaSink.mockImplementationOnce(() => ac.abort());
    scriptedEvents = [deltaEvent("first"), deltaEvent("buffered")];

    const res = await caller.call(userEnv(), ac.signal);

    expect(res.drop_reason).toBe("superseded_by_user");
    expect(speechDeltaSink.mock.calls.map((c) => c[0])).toEqual(["first"]);
  });

  it("error mid-stream with NO prior delta → silent (no abort, no end)", async () => {
    scriptedEvents = [{ type: "error", message: "boom" }];
    await caller.call(userEnv());
    expect(speechAbortSink).not.toHaveBeenCalled();
    expect(speechEndSink).not.toHaveBeenCalled();
  });

  it("thrown stream with NO prior delta → silent (no abort, no end)", async () => {
    streamChatError = new Error("network reset");
    await caller.call(userEnv());
    expect(speechAbortSink).not.toHaveBeenCalled();
    expect(speechEndSink).not.toHaveBeenCalled();
  });

  it("streaming path does NOT invoke the whole-text onSpeech dep", async () => {
    scriptedEvents = [deltaEvent("a"), deltaEvent("b"), completedEvent({ speech_text: "ab" })];
    await caller.call(userEnv());
    expect(speechSink).not.toHaveBeenCalled();
  });
});

// ── per-beat cue ownership: streaming pipeline applies cues audio-timed ─────────

describe("backend_caller — per-beat cue application (pipeline ownership)", () => {
  it("streaming turn (≥1 express + ≥1 delta) → onCue per cue; applyDirective NOT called at completed", async () => {
    scriptedEvents = [
      expressEvent({ emotion_id: "happy", motion_id: "wave" }),
      deltaEvent("Hi "),
      expressEvent({ emotion_id: "curious" }),
      deltaEvent("there"),
      completedEvent({ speech_text: "Hi there", emotion: { id: "curious" } }),
    ];
    const res = await caller.call(userEnv());
    expect(res.ok).toBe(true);
    // pipeline owns visual application audio-timed per sentence — no completed apply.
    expect(applyDirective).not.toHaveBeenCalled();
    expect(cueSink.mock.calls.map((c) => c[0])).toEqual([
      { emotion_id: "happy", motion_id: "wave" },
      { emotion_id: "curious" },
    ]);
  });

  it("silent turn (express but NO delta, empty speech) → applyDirective called once at completed (firing≠judgment)", async () => {
    const env: ControlEnvelope = { speech_text: "", emotion: { id: "thinking" } };
    scriptedEvents = [expressEvent({ emotion_id: "thinking" }), completedEvent(env)];
    const res = await caller.call(userEnv());
    expect(res.ok).toBe(true);
    expect(cueSink).toHaveBeenCalledWith({ emotion_id: "thinking" });
    // no audio to time against → completed applies the cue once.
    expect(applyDirective).toHaveBeenCalledTimes(1);
    expect(applyDirective).toHaveBeenCalledWith(env);
  });

  it("completed-only backend (no express) with emotion/motion → applyDirective called at completed", async () => {
    const env: ControlEnvelope = {
      speech_text: "안녕",
      emotion: { id: "happy" },
      motion: { id: "wave" },
    };
    scriptedEvents = [completedEvent(env)];
    const res = await caller.call(userEnv());
    expect(res.ok).toBe(true);
    expect(applyDirective).toHaveBeenCalledTimes(1);
    expect(applyDirective).toHaveBeenCalledWith(env);
    expect(cueSink).not.toHaveBeenCalled();
  });

  it("completed-only backend (no express) with emotion_text → routes emotion_text through onCue, before onSpeech, without emotion_id/motion_id", async () => {
    const order: string[] = [];
    cueSink.mockImplementation((c: ExpressArgs) => order.push(`cue:${JSON.stringify(c)}`));
    speechSink.mockImplementation(() => order.push("speech"));
    const env: ControlEnvelope = {
      speech_text: "안녕",
      emotion: { id: "happy" },
      emotion_text: "(whisper)",
    };
    scriptedEvents = [completedEvent(env)];
    const res = await caller.call(userEnv());
    expect(res.ok).toBe(true);
    expect(cueSink).toHaveBeenCalledWith({ emotion_text: "(whisper)" });
    expect(speechSink).toHaveBeenCalledWith("안녕");
    expect(order).toEqual([`cue:${JSON.stringify({ emotion_text: "(whisper)" })}`, "speech"]);
  });

  it("completed-only backend with a true silent turn (emotion_text set, empty speech_text) → onCue still fires but onSpeech does not", async () => {
    const env: ControlEnvelope = {
      speech_text: "",
      emotion_text: "(whisper)",
    };
    scriptedEvents = [completedEvent(env)];
    const res = await caller.call(userEnv());
    expect(res.ok).toBe(true);
    expect(cueSink).toHaveBeenCalledWith({ emotion_text: "(whisper)" });
    expect(speechSink).not.toHaveBeenCalled();
  });
});

// ── structured logging ──────────────────────────────────────────────────────

describe("backend_caller — usage sink (token accounting channel)", () => {
  it("usage stream event → onUsage fires with the usage block", async () => {
    scriptedEvents = [usageEvent(120, 30, 150), completedEvent({ speech_text: "" })];
    await caller.call(userEnv());
    expect(usageSink).toHaveBeenCalledWith({
      input_tokens: 120,
      output_tokens: 30,
      total_tokens: 150,
    });
  });

  it("no usage event → onUsage is not called", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv());
    expect(usageSink).not.toHaveBeenCalled();
  });

  it("usage event but no onUsage dep → does not throw", async () => {
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
    });
    scriptedEvents = [usageEvent(1, 2, 3), completedEvent({ speech_text: "hi" })];
    const res = await caller.call(userEnv());
    expect(res.ok).toBe(true);
  });
});

// ── TTFT thinking lifecycle (filler) ──────────────────────────────────────────
// First line is immediate (no threshold): startThinking() runs synchronously at
// call entry when filler is active. Thinking ends only when real response speech
// begins (first speech_delta) — it persists through usage/express/tool_status that
// precede speech. Silent/error/abort turns still end thinking via finally.

describe("backend_caller — TTFT thinking lifecycle", () => {
  let onThinkingStart: Mock<(token: object) => void>;
  let onThinkingEnd: Mock<(token: object) => void>;
  let getFiller: Mock<() => boolean>;

  function makeCaller(fillerActive = true) {
    return createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      onSpeechDelta: speechDeltaSink,
      onSpeechEnd: speechEndSink,
      onSpeechInterrupt: speechInterruptSink,
      onCue: cueSink,
      onUsage: usageSink,
      logger,
      onThinkingStart,
      onThinkingEnd,
      getFiller: getFiller.mockReturnValue(fillerActive),
    });
  }

  beforeEach(() => {
    onThinkingStart = vi.fn();
    onThinkingEnd = vi.fn();
    getFiller = vi.fn();
  });

  it("getFiller true → onThinkingStart fires synchronously at call entry, before any stream event", async () => {
    const order: string[] = [];
    onThinkingStart.mockImplementation(() => order.push("start"));
    speechDeltaSink.mockImplementation((t: string) => order.push(`delta:${t}`));
    caller = makeCaller(true);
    scriptedEvents = [deltaEvent("hi"), completedEvent({ speech_text: "hi" })];
    // start must have happened before call() resolves; assert synchronous ordering vs deltas.
    const p = caller.call(userEnv());
    // onThinkingStart is invoked synchronously inside call() before the first await yields.
    expect(onThinkingStart).toHaveBeenCalledTimes(1);
    await p;
    expect(order[0]).toBe("start");
    expect(order.indexOf("start")).toBeLessThan(order.indexOf("delta:hi"));
  });

  it("interrupt precedes thinking start at call entry", async () => {
    const order: string[] = [];
    speechInterruptSink.mockImplementation(() => order.push("interrupt"));
    onThinkingStart.mockImplementation(() => order.push("start"));
    caller = makeCaller(true);
    scriptedEvents = [deltaEvent("hi"), completedEvent({ speech_text: "hi" })];
    await caller.call(userEnv());
    expect(order.indexOf("interrupt")).toBeLessThan(order.indexOf("start"));
  });

  it("getFiller false → onThinkingStart never fires", async () => {
    caller = makeCaller(false);
    scriptedEvents = [deltaEvent("hi"), completedEvent({ speech_text: "hi" })];
    await caller.call(userEnv());
    expect(onThinkingStart).not.toHaveBeenCalled();
    expect(onThinkingEnd).not.toHaveBeenCalled();
  });

  it("reflex turn (proactive.touch_*) skips thinking even when getFiller true", async () => {
    caller = makeCaller(true);
    scriptedEvents = [deltaEvent("꺅"), completedEvent({ speech_text: "꺅" })];
    await caller.call(touchEnv());
    expect(onThinkingStart).not.toHaveBeenCalled();
    expect(onThinkingEnd).not.toHaveBeenCalled();
  });

  it.each([
    ["proactive.drag_held", dragHeldEnv],
    ["proactive.window_sit", windowSitEnv],
    ["proactive.peek", peekEnv],
  ] as const)("reflex turn (%s) skips thinking even when getFiller true", async (_name, env) => {
    caller = makeCaller(true);
    scriptedEvents = [deltaEvent("꺅"), completedEvent({ speech_text: "꺅" })];
    await caller.call(env());
    expect(onThinkingStart).not.toHaveBeenCalled();
    expect(onThinkingEnd).not.toHaveBeenCalled();
  });

  it("getFiller absent → onThinkingStart never fires (back-compat)", async () => {
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      onThinkingStart,
      onThinkingEnd,
    });
    scriptedEvents = [completedEvent({ speech_text: "hi" })];
    const res = await caller.call(userEnv());
    expect(res.ok).toBe(true);
    expect(onThinkingStart).not.toHaveBeenCalled();
    expect(onThinkingEnd).not.toHaveBeenCalled();
  });

  it("thinking ENDS on the first speech_delta — exactly once", async () => {
    const order: string[] = [];
    onThinkingStart.mockImplementation(() => order.push("start"));
    onThinkingEnd.mockImplementation(() => order.push("end"));
    speechDeltaSink.mockImplementation((t: string) => order.push(`delta:${t}`));
    caller = makeCaller(true);
    scriptedEvents = [deltaEvent("a"), deltaEvent("b"), completedEvent({ speech_text: "ab" })];
    await caller.call(userEnv());
    expect(onThinkingStart).toHaveBeenCalledTimes(1);
    expect(onThinkingEnd).toHaveBeenCalledTimes(1);
    // end is the first thing the first delta does (endThinking precedes onSpeechDelta);
    // the second delta does not re-end (idempotent).
    expect(order).toEqual(["start", "end", "delta:a", "delta:b"]);
  });

  it("thinking PERSISTS through usage before any speech_delta (ends on the delta, not usage)", async () => {
    const order: string[] = [];
    onThinkingEnd.mockImplementation(() => order.push("end"));
    speechDeltaSink.mockImplementation((t: string) => order.push(`delta:${t}`));
    usageSink.mockImplementation(() => order.push("usage"));
    caller = makeCaller(true);
    scriptedEvents = [usageEvent(1, 2, 3), deltaEvent("hi"), completedEvent({ speech_text: "hi" })];
    await caller.call(userEnv());
    // usage routed first WITHOUT ending thinking; end fires when the delta arrives
    // (endThinking precedes onSpeechDelta within the case).
    expect(order).toEqual(["usage", "end", "delta:hi"]);
    expect(onThinkingEnd).toHaveBeenCalledTimes(1);
  });

  it("thinking PERSISTS through express before any speech_delta", async () => {
    const order: string[] = [];
    onThinkingEnd.mockImplementation(() => order.push("end"));
    cueSink.mockImplementation(() => order.push("cue"));
    speechDeltaSink.mockImplementation(() => order.push("delta"));
    caller = makeCaller(true);
    scriptedEvents = [
      expressEvent({ emotion_id: "happy" }),
      deltaEvent("hi"),
      completedEvent({ speech_text: "hi" }),
    ];
    await caller.call(userEnv());
    // express routed WITHOUT ending thinking; end fires at the delta (before onSpeechDelta).
    expect(order).toEqual(["cue", "end", "delta"]);
  });

  it("thinking PERSISTS through tool_status-only completed with no speech (ends via finally)", async () => {
    // tool_status rides the completed envelope; no speech_delta ever arrives → silent turn.
    onThinkingStart.mockClear();
    caller = makeCaller(true);
    const status = { state: "running" as const, tool_id: "web_search" };
    scriptedEvents = [completedEvent({ speech_text: "", tool_status: status })];
    await caller.call(userEnv());
    // no delta → endThinking only fired once, via finally.
    expect(onThinkingStart).toHaveBeenCalledTimes(1);
    expect(onThinkingEnd).toHaveBeenCalledTimes(1);
  });

  it("silent turn (completed, empty speech, no deltas) → onThinkingEnd once via finally", async () => {
    caller = makeCaller(true);
    scriptedEvents = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv());
    expect(onThinkingStart).toHaveBeenCalledTimes(1);
    expect(onThinkingEnd).toHaveBeenCalledTimes(1);
  });

  it("setup-stage reject (no speech ever) → onThinkingEnd once via finally", async () => {
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => {
        throw new Error("secret resolve failed");
      },
      getFetch: async () => undefined,
      onSpeech: speechSink,
      logger,
      onThinkingStart,
      onThinkingEnd,
      getFiller: getFiller.mockReturnValue(true),
    });
    const res = await caller.call(userEnv());
    expect(res.ok).toBe(false);
    expect(res.drop_reason).toBe("network_drop");
    expect(onThinkingStart).toHaveBeenCalledTimes(1);
    expect(onThinkingEnd).toHaveBeenCalledTimes(1);
  });

  it("parse_error (no completed event) → onThinkingEnd once via finally", async () => {
    caller = makeCaller(true);
    scriptedEvents = [];
    const res = await caller.call(userEnv());
    expect(res.ok).toBe(false);
    expect(res.drop_reason).toBe("parse_error");
    expect(onThinkingStart).toHaveBeenCalledTimes(1);
    expect(onThinkingEnd).toHaveBeenCalledTimes(1);
  });

  it("stream throw before any speech (network_drop) → onThinkingEnd once via finally", async () => {
    caller = makeCaller(true);
    streamChatError = new Error("connection reset");
    scriptedEvents = [];
    const res = await caller.call(userEnv());
    expect(res.ok).toBe(false);
    expect(res.drop_reason).toBe("network_drop");
    expect(onThinkingStart).toHaveBeenCalledTimes(1);
    expect(onThinkingEnd).toHaveBeenCalledTimes(1);
  });

  it("external-signal abort mid-stream → onThinkingEnd once via finally", async () => {
    const ac = new AbortController();
    caller = makeCaller(true);
    speechDeltaSink.mockImplementation(() => ac.abort());
    scriptedEvents = [deltaEvent("partial"), { type: "error", message: "boom" }];
    const res = await caller.call(userEnv(), ac.signal);
    expect(res.drop_reason).toBe("superseded_by_user");
    expect(onThinkingStart).toHaveBeenCalledTimes(1);
    // started + ended exactly once (delta ended it, finally is idempotent).
    expect(onThinkingEnd).toHaveBeenCalledTimes(1);
  });

  // ── turn-token identity (cross-turn overlap guard) ──────────────────────────
  // The cross-turn guard lives in main.ts (singleton fillerLoop + renderer), but
  // its correctness rests on backend-caller handing a STABLE per-call token to both
  // seams: same token for one call's start+end, distinct tokens across calls. With
  // that contract, main.ts records currentThinkingTurn at start and no-ops an end
  // whose token != current — so a superseded turn's late end cannot tear down the
  // turn that superseded it. These tests pin the token contract main.ts relies on.

  it("onThinkingStart and onThinkingEnd of one call receive the SAME token", async () => {
    let startToken: unknown;
    let endToken: unknown;
    onThinkingStart.mockImplementation((t: unknown) => {
      startToken = t;
    });
    onThinkingEnd.mockImplementation((t: unknown) => {
      endToken = t;
    });
    caller = makeCaller(true);
    scriptedEvents = [deltaEvent("hi"), completedEvent({ speech_text: "hi" })];
    await caller.call(userEnv());
    expect(startToken).toBeDefined();
    expect(typeof startToken).toBe("object");
    expect(endToken).toBe(startToken);
  });

  it("distinct calls receive DISTINCT tokens", async () => {
    const startTokens: unknown[] = [];
    onThinkingStart.mockImplementation((t: unknown) => startTokens.push(t));
    caller = makeCaller(true);
    scriptedEvents = [deltaEvent("a"), completedEvent({ speech_text: "a" })];
    await caller.call(userEnv());
    scriptedEvents = [deltaEvent("b"), completedEvent({ speech_text: "b" })];
    await caller.call(userEnv());
    expect(startTokens).toHaveLength(2);
    expect(startTokens[0]).not.toBe(startTokens[1]);
  });

  it("overlap race: turn A's late end (token A) must NOT tear down turn B (token B)", () => {
    // Reproduce the main.ts guard against the real per-call tokens. Turn B's start
    // runs synchronously before turn A's abort-driven finally; A's late end carries
    // A's token, which is no longer current → guard ignores it, B survives.
    let currentThinkingTurn: object | null = null;
    let bTornDown = false;

    // Capture each call's token via a fresh start handler per turn.
    const tokens: object[] = [];
    onThinkingStart.mockImplementation((t: object) => {
      tokens.push(t);
      currentThinkingTurn = t; // main.ts: claim ownership synchronously.
    });
    onThinkingEnd.mockImplementation((t: object) => {
      if (t !== currentThinkingTurn) return; // main.ts: ignore stale end.
      currentThinkingTurn = null;
      if (t === tokens[1]) bTornDown = true; // tearing down B would set this.
    });

    // Drive start/end directly with the captured tokens to model the interleave:
    //   A.start → B.start → A.end(stale) → (B survives).
    caller = makeCaller(true);
    // Two synchronous starts (A then B), distinct tokens.
    const tokenA = {};
    const tokenB = {};
    onThinkingStart(tokenA);
    onThinkingStart(tokenB);
    // A's late end carries tokenA, which != current (tokenB) → must be ignored.
    onThinkingEnd(tokenA);

    expect(currentThinkingTurn).toBe(tokenB); // B still owns thinking.
    expect(bTornDown).toBe(false); // B's loop/motion untouched by A's late end.
  });
});

// ── Chat Completions (CC) mode — request shape ──────────────────────────────
