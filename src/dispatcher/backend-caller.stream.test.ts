/**
 * backend-caller.stream.test.ts — streaming path (speech gate, cue/tool_status forwarding, deltas, per-beat cues, usage, TTFT lifecycle).
 *
 * Split from backend-caller.test.ts. Shared stateless fixtures live in ./test-helpers.ts; the
 * chat stream is injected per caller from the shared scripted fixture (BackendCallerDeps.stream).
 */

import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { ControlEnvelope, ExpressArgs, ToolStatus, Usage } from "../contract";
import type { Logger } from "../logger";
import { type BackendCaller, createBackendCaller } from "./backend-caller";
import {
  CONFIG,
  completedEvent,
  createScriptedStream,
  deltaEvent,
  dragHeldEnv,
  expressEvent,
  makeLogger,
  makeTurnOutput,
  peekEnv,
  toolStatusEvent,
  touchEnv,
  turnOf,
  usageEvent,
  userEnv,
  windowSitEnv,
} from "./test-helpers";

const script = createScriptedStream();
let applyDirective: ReturnType<typeof vi.fn>;
let turnOutput: ReturnType<typeof makeTurnOutput>;
let toolStatusSink: Mock<(status: ToolStatus) => void>;
let usageSink: Mock<(usage: Usage) => void>;
let spokeTextSink: Mock<(spoke: boolean) => void>;
let caller: BackendCaller;
let logger: Logger;

beforeEach(() => {
  script.reset();
  applyDirective = vi.fn();
  turnOutput = makeTurnOutput();
  toolStatusSink = vi.fn();
  usageSink = vi.fn();
  spokeTextSink = vi.fn();
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
    reportSpokeText: spokeTextSink,
    logger,
  });
});

describe("backend_caller — B4 speech gate (speech_text only)", () => {
  it("non-empty speech_text → applyDirective + speech sink (B5)", async () => {
    const env: ControlEnvelope = {
      speech_text: "응 듣고 있어",
      emotion: { id: "happy" },
    };
    script.events = [completedEvent(env)];
    const res = await caller.call(turnOf(userEnv()));
    expect(res).toBe("ok");
    expect(applyDirective).toHaveBeenCalledWith(env);
    expect(turnOutput.speak).toHaveBeenCalledWith("응 듣고 있어");
  });

  it("empty speech_text → no speech, but render channels still applied (silence = empty text)", async () => {
    const env: ControlEnvelope = {
      speech_text: "",
      emotion: { id: "thinking" },
    };
    script.events = [completedEvent(env)];
    const res = await caller.call(turnOf(userEnv()));
    expect(res).toBe("ok");
    expect(turnOutput.speak).not.toHaveBeenCalled();
    // emotion/motion still rendered (firing≠judgment: silence only gates speech).
    expect(applyDirective).toHaveBeenCalledWith(env);
  });

  it("reports spoke text true for non-empty speech_text on the completed-only path", async () => {
    script.events = [completedEvent({ speech_text: "응 듣고 있어" })];
    await caller.call(turnOf(userEnv()));
    expect(spokeTextSink).toHaveBeenCalledWith(true);
  });

  it("reports spoke text true for a streamed reply", async () => {
    script.events = [deltaEvent("안녕"), completedEvent({ speech_text: "안녕" })];
    await caller.call(turnOf(userEnv()));
    expect(spokeTextSink).toHaveBeenCalledWith(true);
  });

  it("reports spoke text false for empty speech_text", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    await caller.call(turnOf(userEnv()));
    expect(spokeTextSink).toHaveBeenCalledWith(false);
  });
});

describe("backend_caller — B5 cue forwarding + tool_status callbacks", () => {
  it("forwards each express cue to turnOutput.cue (full args, not just emotion_text)", async () => {
    script.events = [
      deltaEvent("hi "),
      expressEvent({ emotion_id: "happy", motion_id: "wave", emotion_text: "(whisper)" }),
      completedEvent({ speech_text: "hi", emotion_text: "(whisper)" }),
    ];
    await caller.call(turnOf(userEnv()));
    expect(turnOutput.cue).toHaveBeenCalledWith({
      emotion_id: "happy",
      motion_id: "wave",
      emotion_text: "(whisper)",
    });
  });

  it("forwards a streamed caption on the cue untouched", async () => {
    script.events = [
      deltaEvent("hi "),
      expressEvent({ emotion_text: "👂", caption: "囁くような小さな声で。" }),
      completedEvent({ speech_text: "hi", emotion_text: "👂" }),
    ];
    await caller.call(turnOf(userEnv()));
    expect(turnOutput.cue).toHaveBeenCalledWith({
      emotion_text: "👂",
      caption: "囁くような小さな声で。",
    });
  });

  it("does not call turnOutput.cue when the stream yields no express event", async () => {
    const env: ControlEnvelope = { speech_text: "안녕", emotion: { id: "happy" } };
    script.events = [deltaEvent("안녕"), completedEvent(env)];
    await caller.call(turnOf(userEnv()));
    expect(turnOutput.cue).not.toHaveBeenCalled();
  });

  it("forwards each streamed tool_status event to onToolStatus (running spinner, done check)", async () => {
    const running = { state: "running" as const, tool_id: "web_search" };
    const done = { state: "done" as const, tool_id: "web_search" };
    script.events = [
      toolStatusEvent(running),
      toolStatusEvent(done),
      completedEvent({ speech_text: "" }),
    ];
    await caller.call(turnOf(userEnv()));
    expect(toolStatusSink).toHaveBeenNthCalledWith(1, running);
    expect(toolStatusSink).toHaveBeenNthCalledWith(2, done);
  });

  it("emits an idle status when a running tool never completes (turn drops mid-flight)", async () => {
    const running = { state: "running" as const, tool_id: "web_search" };
    script.events = [toolStatusEvent(running)];
    script.error = new Error("drop");
    const res = await caller.call(turnOf(userEnv()));
    expect(res).toBe("network_drop");
    expect(toolStatusSink).toHaveBeenNthCalledWith(1, running);
    expect(toolStatusSink).toHaveBeenLastCalledWith({ state: "idle" });
  });

  it("does not emit idle when the tool completes normally (done seen)", async () => {
    script.events = [
      toolStatusEvent({ state: "running", tool_id: "web_search" }),
      toolStatusEvent({ state: "done", tool_id: "web_search" }),
      completedEvent({ speech_text: "" }),
    ];
    await caller.call(turnOf(userEnv()));
    expect(toolStatusSink).not.toHaveBeenCalledWith({ state: "idle" });
  });

  it("forwards each streamed tool_status event to turnOutput.toolStatus(turnId, state, tool_id)", async () => {
    const running = { state: "running" as const, tool_id: "web_search" };
    const done = { state: "done" as const, tool_id: "web_search" };
    script.events = [
      toolStatusEvent(running),
      toolStatusEvent(done),
      completedEvent({ speech_text: "" }),
    ];
    await caller.call(turnOf(userEnv(), 7));
    expect(turnOutput.toolStatus).toHaveBeenNthCalledWith(1, 7, "running", "web_search");
    expect(turnOutput.toolStatus).toHaveBeenNthCalledWith(2, 7, "done", "web_search");
  });

  it("forwards each streamed express event to turnOutput.activity(turnId)", async () => {
    script.events = [
      deltaEvent("hi "),
      expressEvent({ emotion_id: "happy" }),
      completedEvent({ speech_text: "hi" }),
    ];
    await caller.call(turnOf(userEnv(), 7));
    expect(turnOutput.activity).toHaveBeenCalledOnce();
    expect(turnOutput.activity).toHaveBeenCalledWith(7);
  });
});

describe("backend_caller — streaming speech deltas (incremental TTS)", () => {
  it("each speech_delta → turnOutput.delta in order; turnOutput.end once after all deltas", async () => {
    script.events = [
      deltaEvent("Hel"),
      deltaEvent("lo "),
      deltaEvent("world"),
      completedEvent({ speech_text: "Hello world" }),
    ];
    await caller.call(turnOf(userEnv()));
    expect(turnOutput.delta.mock.calls.map((c) => c[0])).toEqual(["Hel", "lo ", "world"]);
    expect(turnOutput.end).toHaveBeenCalledTimes(1);
  });

  it("turnOutput.interrupt fires once at the START of call(), before the first delta", async () => {
    const order: string[] = [];
    turnOutput.interrupt.mockImplementation(() => order.push("interrupt"));
    turnOutput.delta.mockImplementation((t: string) => order.push(`delta:${t}`));
    turnOutput.end.mockImplementation(() => order.push("end"));
    script.events = [deltaEvent("a"), deltaEvent("b"), completedEvent({ speech_text: "ab" })];
    await caller.call(turnOf(userEnv()));
    expect(turnOutput.interrupt).toHaveBeenCalledTimes(1);
    // interrupt precedes every delta (and the end).
    expect(order).toEqual(["interrupt", "delta:a", "delta:b", "end"]);
  });

  it("express cue → turnOutput.cue DURING the stream, before turnOutput.end", async () => {
    const order: string[] = [];
    turnOutput.cue.mockImplementation((c: ExpressArgs) => order.push(`cue:${c.emotion_text}`));
    turnOutput.delta.mockImplementation((t: string) => order.push(`delta:${t}`));
    turnOutput.end.mockImplementation(() => order.push("end"));
    script.events = [
      deltaEvent("hi "),
      expressEvent({ emotion_text: "(whisper)" }),
      deltaEvent("there"),
      completedEvent({ speech_text: "hi there", emotion_text: "(whisper)" }),
    ];
    await caller.call(turnOf(userEnv()));
    expect(turnOutput.cue).toHaveBeenCalledWith({ emotion_text: "(whisper)" });
    // cue routed mid-stream, strictly before the end signal.
    expect(order.indexOf("cue:(whisper)")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("cue:(whisper)")).toBeLessThan(order.indexOf("end"));
  });

  it("empty speech_text: no speech_delta → neither turnOutput.delta nor turnOutput.end", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    await caller.call(turnOf(userEnv()));
    expect(turnOutput.delta).not.toHaveBeenCalled();
    expect(turnOutput.end).not.toHaveBeenCalled();
  });

  it("error mid-stream after ≥1 delta → turnOutput.abort tears down (not turnOutput.end)", async () => {
    script.events = [deltaEvent("partial"), { type: "error", message: "boom" }];
    await caller.call(turnOf(userEnv()));
    expect(turnOutput.end).not.toHaveBeenCalled();
    expect(turnOutput.abort).toHaveBeenCalledTimes(1);
  });

  it("thrown stream mid-flight after ≥1 delta → turnOutput.abort tears down (not turnOutput.end)", async () => {
    script.events = [deltaEvent("partial")];
    script.error = new Error("network reset");
    await caller.call(turnOf(userEnv()));
    expect(turnOutput.end).not.toHaveBeenCalled();
    expect(turnOutput.abort).toHaveBeenCalledTimes(1);
  });

  it("user-supersede mid-stream (aborted signal) → NO abort teardown (next turn cleans up)", async () => {
    const ac = new AbortController();
    turnOutput.delta.mockImplementation(() => ac.abort());
    script.events = [deltaEvent("partial"), { type: "error", message: "boom" }];
    const res = await caller.call(turnOf(userEnv()), ac.signal);
    expect(res).toBe("superseded_by_user");
    expect(turnOutput.abort).not.toHaveBeenCalled();
    expect(turnOutput.end).not.toHaveBeenCalled();
  });

  it("drops a buffered speech delta yielded after the external signal aborts", async () => {
    const ac = new AbortController();
    turnOutput.delta.mockImplementationOnce(() => ac.abort());
    script.events = [deltaEvent("first"), deltaEvent("buffered")];

    const res = await caller.call(turnOf(userEnv()), ac.signal);

    expect(res).toBe("superseded_by_user");
    expect(turnOutput.delta.mock.calls.map((c) => c[0])).toEqual(["first"]);
  });

  it("error mid-stream with NO prior delta → silent (no abort, no end)", async () => {
    script.events = [{ type: "error", message: "boom" }];
    await caller.call(turnOf(userEnv()));
    expect(turnOutput.abort).not.toHaveBeenCalled();
    expect(turnOutput.end).not.toHaveBeenCalled();
  });

  it("thrown stream with NO prior delta → silent (no abort, no end)", async () => {
    script.error = new Error("network reset");
    await caller.call(turnOf(userEnv()));
    expect(turnOutput.abort).not.toHaveBeenCalled();
    expect(turnOutput.end).not.toHaveBeenCalled();
  });

  it("streaming path does NOT invoke the whole-text turnOutput.speak dep", async () => {
    script.events = [deltaEvent("a"), deltaEvent("b"), completedEvent({ speech_text: "ab" })];
    await caller.call(turnOf(userEnv()));
    expect(turnOutput.speak).not.toHaveBeenCalled();
  });
});

// ── per-beat cue ownership: streaming pipeline applies cues audio-timed ─────────

describe("backend_caller — per-beat cue application (pipeline ownership)", () => {
  it("streaming turn (≥1 express + ≥1 delta) → turnOutput.cue per cue; applyDirective NOT called at completed", async () => {
    script.events = [
      expressEvent({ emotion_id: "happy", motion_id: "wave" }),
      deltaEvent("Hi "),
      expressEvent({ emotion_id: "curious" }),
      deltaEvent("there"),
      completedEvent({ speech_text: "Hi there", emotion: { id: "curious" } }),
    ];
    const res = await caller.call(turnOf(userEnv()));
    expect(res).toBe("ok");
    // pipeline owns visual application audio-timed per sentence — no completed apply.
    expect(applyDirective).not.toHaveBeenCalled();
    expect(turnOutput.cue.mock.calls.map((c) => c[0])).toEqual([
      { emotion_id: "happy", motion_id: "wave" },
      { emotion_id: "curious" },
    ]);
  });

  it("silent turn (express but NO delta, empty speech) → applyDirective called once at completed (firing≠judgment)", async () => {
    const env: ControlEnvelope = { speech_text: "", emotion: { id: "thinking" } };
    script.events = [expressEvent({ emotion_id: "thinking" }), completedEvent(env)];
    const res = await caller.call(turnOf(userEnv()));
    expect(res).toBe("ok");
    expect(turnOutput.cue).toHaveBeenCalledWith({ emotion_id: "thinking" });
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
    script.events = [completedEvent(env)];
    const res = await caller.call(turnOf(userEnv()));
    expect(res).toBe("ok");
    expect(applyDirective).toHaveBeenCalledTimes(1);
    expect(applyDirective).toHaveBeenCalledWith(env);
    expect(turnOutput.cue).not.toHaveBeenCalled();
  });

  it("completed-only backend (no express) with emotion_text → routes emotion_text through turnOutput.cue, before turnOutput.speak, without emotion_id/motion_id", async () => {
    const order: string[] = [];
    turnOutput.cue.mockImplementation((c: ExpressArgs) => order.push(`cue:${JSON.stringify(c)}`));
    turnOutput.speak.mockImplementation(() => order.push("speech"));
    const env: ControlEnvelope = {
      speech_text: "안녕",
      emotion: { id: "happy" },
      emotion_text: "(whisper)",
    };
    script.events = [completedEvent(env)];
    const res = await caller.call(turnOf(userEnv()));
    expect(res).toBe("ok");
    expect(turnOutput.cue).toHaveBeenCalledWith({ emotion_text: "(whisper)" });
    expect(turnOutput.speak).toHaveBeenCalledWith("안녕");
    expect(order).toEqual([`cue:${JSON.stringify({ emotion_text: "(whisper)" })}`, "speech"]);
  });

  it("completed-only backend routes the envelope caption through the same cue channel", async () => {
    const env: ControlEnvelope = {
      speech_text: "안녕",
      emotion: { id: "happy" },
      emotion_text: "👂",
      caption: "囁くような小さな声で。",
    };
    script.events = [completedEvent(env)];
    await caller.call(turnOf(userEnv()));
    expect(turnOutput.cue).toHaveBeenCalledWith({
      emotion_text: "👂",
      caption: "囁くような小さな声で。",
    });
  });

  it("completed-only backend routes a caption-only envelope through the cue channel", async () => {
    const env: ControlEnvelope = { speech_text: "안녕", caption: "落ち着いた低めの声で。" };
    script.events = [completedEvent(env)];
    await caller.call(turnOf(userEnv()));
    expect(turnOutput.cue).toHaveBeenCalledWith({ caption: "落ち着いた低めの声で。" });
  });

  it("completed-only backend with a true silent turn (emotion_text set, empty speech_text) → turnOutput.cue still fires but turnOutput.speak does not", async () => {
    const env: ControlEnvelope = {
      speech_text: "",
      emotion_text: "(whisper)",
    };
    script.events = [completedEvent(env)];
    const res = await caller.call(turnOf(userEnv()));
    expect(res).toBe("ok");
    expect(turnOutput.cue).toHaveBeenCalledWith({ emotion_text: "(whisper)" });
    expect(turnOutput.speak).not.toHaveBeenCalled();
  });
});

// ── structured logging ──────────────────────────────────────────────────────

describe("backend_caller — usage sink (token accounting channel)", () => {
  it("usage stream event → onUsage fires with the usage block", async () => {
    script.events = [usageEvent(120, 30, 150), completedEvent({ speech_text: "" })];
    await caller.call(turnOf(userEnv()));
    expect(usageSink).toHaveBeenCalledWith({
      input_tokens: 120,
      output_tokens: 30,
      total_tokens: 150,
    });
  });

  it("no usage event → onUsage is not called", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    await caller.call(turnOf(userEnv()));
    expect(usageSink).not.toHaveBeenCalled();
  });

  it("usage event but no onUsage dep → does not throw", async () => {
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
    });
    script.events = [usageEvent(1, 2, 3), completedEvent({ speech_text: "hi" })];
    const res = await caller.call(turnOf(userEnv()));
    expect(res).toBe("ok");
  });
});

// ── TTFT thinking lifecycle (filler) ──────────────────────────────────────────
// First line is immediate (no threshold): startThinking() runs synchronously at
// call entry when filler is active. Thinking ends only when real response speech
// begins (first speech_delta) — it persists through usage/express/tool_status that
// precede speech. Silent/error/abort turns still end thinking via finally.

describe("backend_caller — TTFT thinking lifecycle", () => {
  function makeCaller(fillerActive = true) {
    turnOutput.hasFiller.mockReturnValue(fillerActive);
    return createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      onUsage: usageSink,
      logger,
    });
  }

  it("thinkingStart and thinkingEnd both carry the id of the turn passed to call()", async () => {
    caller = makeCaller(true);
    script.events = [deltaEvent("hi"), completedEvent({ speech_text: "hi" })];
    await caller.call(turnOf(userEnv(), 42));
    expect(turnOutput.thinkingStart).toHaveBeenCalledWith(42);
    expect(turnOutput.thinkingEnd).toHaveBeenCalledWith(42);
  });

  it("hasFiller true → thinkingStart fires synchronously at call entry, before any stream event", async () => {
    const order: string[] = [];
    turnOutput.thinkingStart.mockImplementation(() => order.push("start"));
    turnOutput.delta.mockImplementation((t: string) => order.push(`delta:${t}`));
    caller = makeCaller(true);
    script.events = [deltaEvent("hi"), completedEvent({ speech_text: "hi" })];
    // start must have happened before call() resolves; assert synchronous ordering vs deltas.
    const p = caller.call(turnOf(userEnv()));
    // thinkingStart is invoked synchronously inside call() before the first await yields.
    expect(turnOutput.thinkingStart).toHaveBeenCalledTimes(1);
    await p;
    expect(order[0]).toBe("start");
    expect(order.indexOf("start")).toBeLessThan(order.indexOf("delta:hi"));
  });

  it("interrupt precedes thinking start at call entry", async () => {
    const order: string[] = [];
    turnOutput.interrupt.mockImplementation(() => order.push("interrupt"));
    turnOutput.thinkingStart.mockImplementation(() => order.push("start"));
    caller = makeCaller(true);
    script.events = [deltaEvent("hi"), completedEvent({ speech_text: "hi" })];
    await caller.call(turnOf(userEnv()));
    expect(order.indexOf("interrupt")).toBeLessThan(order.indexOf("start"));
  });

  it("hasFiller false → thinkingStart never fires", async () => {
    caller = makeCaller(false);
    script.events = [deltaEvent("hi"), completedEvent({ speech_text: "hi" })];
    await caller.call(turnOf(userEnv()));
    expect(turnOutput.thinkingStart).not.toHaveBeenCalled();
    expect(turnOutput.thinkingEnd).not.toHaveBeenCalled();
  });

  it("reflex turn (proactive.touch_*) skips thinking even when hasFiller true", async () => {
    caller = makeCaller(true);
    script.events = [deltaEvent("꺅"), completedEvent({ speech_text: "꺅" })];
    await caller.call(turnOf(touchEnv()));
    expect(turnOutput.thinkingStart).not.toHaveBeenCalled();
    expect(turnOutput.thinkingEnd).not.toHaveBeenCalled();
  });

  it.each([
    ["proactive.drag_held", dragHeldEnv],
    ["proactive.window_sit", windowSitEnv],
    ["proactive.peek", peekEnv],
  ] as const)("reflex turn (%s) skips thinking even when hasFiller true", async (_name, env) => {
    caller = makeCaller(true);
    script.events = [deltaEvent("꺅"), completedEvent({ speech_text: "꺅" })];
    await caller.call(turnOf(env()));
    expect(turnOutput.thinkingStart).not.toHaveBeenCalled();
    expect(turnOutput.thinkingEnd).not.toHaveBeenCalled();
  });

  it("turnOutput absent → thinkingStart never fires (missing port stays falsy, not true)", async () => {
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
    });
    script.events = [completedEvent({ speech_text: "hi" })];
    const res = await caller.call(turnOf(userEnv()));
    expect(res).toBe("ok");
  });

  it("thinking ENDS on the first speech_delta — exactly once", async () => {
    const order: string[] = [];
    turnOutput.thinkingStart.mockImplementation(() => order.push("start"));
    turnOutput.thinkingEnd.mockImplementation(() => order.push("end"));
    turnOutput.delta.mockImplementation((t: string) => order.push(`delta:${t}`));
    caller = makeCaller(true);
    script.events = [deltaEvent("a"), deltaEvent("b"), completedEvent({ speech_text: "ab" })];
    await caller.call(turnOf(userEnv()));
    expect(turnOutput.thinkingStart).toHaveBeenCalledTimes(1);
    expect(turnOutput.thinkingEnd).toHaveBeenCalledTimes(1);
    // end is the first thing the first delta does (endThinking precedes turnOutput.delta);
    // the second delta does not re-end (idempotent).
    expect(order).toEqual(["start", "end", "delta:a", "delta:b"]);
  });

  it("thinking PERSISTS through usage before any speech_delta (ends on the delta, not usage)", async () => {
    const order: string[] = [];
    turnOutput.thinkingEnd.mockImplementation(() => order.push("end"));
    turnOutput.delta.mockImplementation((t: string) => order.push(`delta:${t}`));
    usageSink.mockImplementation(() => order.push("usage"));
    caller = makeCaller(true);
    script.events = [usageEvent(1, 2, 3), deltaEvent("hi"), completedEvent({ speech_text: "hi" })];
    await caller.call(turnOf(userEnv()));
    // usage routed first WITHOUT ending thinking; end fires when the delta arrives
    // (endThinking precedes turnOutput.delta within the case).
    expect(order).toEqual(["usage", "end", "delta:hi"]);
    expect(turnOutput.thinkingEnd).toHaveBeenCalledTimes(1);
  });

  it("thinking PERSISTS through express before any speech_delta", async () => {
    const order: string[] = [];
    turnOutput.thinkingEnd.mockImplementation(() => order.push("end"));
    turnOutput.cue.mockImplementation(() => order.push("cue"));
    turnOutput.delta.mockImplementation(() => order.push("delta"));
    caller = makeCaller(true);
    script.events = [
      expressEvent({ emotion_id: "happy" }),
      deltaEvent("hi"),
      completedEvent({ speech_text: "hi" }),
    ];
    await caller.call(turnOf(userEnv()));
    // express routed WITHOUT ending thinking; end fires at the delta (before turnOutput.delta).
    expect(order).toEqual(["cue", "end", "delta"]);
  });

  it("thinking PERSISTS through tool_status-only completed with no speech (ends via finally)", async () => {
    // tool_status rides the completed envelope; no speech_delta ever arrives → silent turn.
    turnOutput.thinkingStart.mockClear();
    caller = makeCaller(true);
    const status = { state: "running" as const, tool_id: "web_search" };
    script.events = [completedEvent({ speech_text: "", tool_status: status })];
    await caller.call(turnOf(userEnv()));
    // no delta → endThinking only fired once, via finally.
    expect(turnOutput.thinkingStart).toHaveBeenCalledTimes(1);
    expect(turnOutput.thinkingEnd).toHaveBeenCalledTimes(1);
  });

  it("silent turn (completed, empty speech, no deltas) → thinkingEnd once via finally", async () => {
    caller = makeCaller(true);
    script.events = [completedEvent({ speech_text: "" })];
    await caller.call(turnOf(userEnv()));
    expect(turnOutput.thinkingStart).toHaveBeenCalledTimes(1);
    expect(turnOutput.thinkingEnd).toHaveBeenCalledTimes(1);
  });

  it("setup-stage reject (no speech ever) → thinkingEnd once via finally", async () => {
    turnOutput.hasFiller.mockReturnValue(true);
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => {
        throw new Error("secret resolve failed");
      },
      getFetch: async () => undefined,
      stream: script.stream,
      logger,
      turnOutput,
    });
    const res = await caller.call(turnOf(userEnv()));
    expect(res).toBe("network_drop");
    expect(turnOutput.thinkingStart).toHaveBeenCalledTimes(1);
    expect(turnOutput.thinkingEnd).toHaveBeenCalledTimes(1);
  });

  it("parse_error (no completed event) → thinkingEnd once via finally", async () => {
    caller = makeCaller(true);
    script.events = [];
    const res = await caller.call(turnOf(userEnv()));
    expect(res).toBe("parse_error");
    expect(turnOutput.thinkingStart).toHaveBeenCalledTimes(1);
    expect(turnOutput.thinkingEnd).toHaveBeenCalledTimes(1);
  });

  it("stream throw before any speech (network_drop) → thinkingEnd once via finally", async () => {
    caller = makeCaller(true);
    script.error = new Error("connection reset");
    script.events = [];
    const res = await caller.call(turnOf(userEnv()));
    expect(res).toBe("network_drop");
    expect(turnOutput.thinkingStart).toHaveBeenCalledTimes(1);
    expect(turnOutput.thinkingEnd).toHaveBeenCalledTimes(1);
  });

  it("external-signal abort mid-stream → thinkingEnd once via finally", async () => {
    const ac = new AbortController();
    caller = makeCaller(true);
    turnOutput.delta.mockImplementation(() => ac.abort());
    script.events = [deltaEvent("partial"), { type: "error", message: "boom" }];
    const res = await caller.call(turnOf(userEnv()), ac.signal);
    expect(res).toBe("superseded_by_user");
    expect(turnOutput.thinkingStart).toHaveBeenCalledTimes(1);
    // started + ended exactly once (delta ended it, finally is idempotent).
    expect(turnOutput.thinkingEnd).toHaveBeenCalledTimes(1);
  });
});

// ── 404 chain-break retry: per-attempt state must not leak ─────────────────────

describe("backend_caller — 404 chain-break retry does not leak attempt-1 envelope", () => {
  it("retry attempt with neither completed nor error → parse_error, attempt-1 responseId not persisted", async () => {
    const onResponseId = vi.fn();
    const onResponseIdInvalid = vi.fn();
    const onChainReset = vi.fn();
    let stored: string | undefined = "resp_dead";
    const getPreviousResponseId = vi.fn(() => stored);
    onResponseIdInvalid.mockImplementation(() => {
      stored = undefined;
    });

    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      onToolStatus: toolStatusSink,
      onUsage: usageSink,
      getPreviousResponseId,
      onResponseId,
      onResponseIdInvalid,
      onChainReset,
      logger,
    });

    // Attempt 1: silent completed (no speech_delta) — sets `envelope`/`newResponseId` —
    // then a 404 chain-break error triggers the retry.
    script.events = [
      completedEvent({ speech_text: "" }, "resp_attempt1"),
      { type: "error", message: "Previous response not found: resp_dead", status: 404 },
    ];
    // Attempt 2 (the retry): stream ends with neither `completed` nor `error`.
    script.eventsRetry = [];

    const res = await caller.call(turnOf(userEnv()));

    expect(script.spy).toHaveBeenCalledTimes(2);
    expect(res).toBe("parse_error");
    expect(applyDirective).not.toHaveBeenCalled();
    expect(onResponseId).not.toHaveBeenCalled();
  });
});

// ── Chat Completions (CC) mode — request shape ──────────────────────────────
