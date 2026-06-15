/**
 * backend-caller.test.ts — Backend caller B1–B5.
 *
 * Locks:
 *  - B1 package_context → contract §4 InputContext (user_text + env.timestamp + env.timezone).
 *  - B2 streamChat invocation with injected fetch + apiKey from secrets, AbortSignal threaded.
 *  - B3 consume chat-client `completed` event → ControlEnvelope (no SSE re-parse).
 *  - B4 speech gate by speech_text only (empty = skip, no flag).
 *  - B5 dispatch_to_renderer → renderer.applyDirective(envelope) + speech_text → speech sink
 *       + cue → onCue + tool_status → onToolStatus (callbacks fire).
 *  - parse_error / network drop classification.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ControlEnvelope, EndpointsConfig, ExpressArgs, InputContext } from "../contract";
import type { ChatStreamEvent } from "../io/chat-client";
import type { Logger } from "../logger";
import type { BusEnvelope } from "./event-bus";

// ── streamChat mock (so we don't hit the SDK / network) ───────────────────────
let scriptedEvents: ChatStreamEvent[] = [];
let streamChatError: Error | null = null;
const streamChatSpy = vi.fn();

vi.mock("../io/chat-client", () => ({
  async *streamChat(...args: unknown[]) {
    streamChatSpy(...args);
    // yield scripted events first, then throw — models a stream that drops mid-flight.
    for (const ev of scriptedEvents) yield ev;
    if (streamChatError) throw streamChatError;
  },
}));

import { type BackendCaller, createBackendCaller } from "./backend-caller";

const CONFIG: EndpointsConfig = {
  chat_base_url: "http://localhost:8643/v1",
  chat_endpoint: "/v1/responses",
  stt_base_url: "http://localhost:5517",
  tts_base_url: "http://localhost:8092",
};

function userEnv(text = "안녕"): BusEnvelope {
  return {
    seq_id: 1,
    source: "user_input_source",
    event_name: "user.text_submitted",
    ts: 1_717_000_000_000,
    payload: { text },
    hint_tier: 2,
    dnd_override: true,
  };
}

function completedEvent(env: ControlEnvelope): ChatStreamEvent {
  return { type: "completed", envelope: env };
}

function deltaEvent(text: string): ChatStreamEvent {
  return { type: "speech_delta", text };
}

function expressEvent(args: ExpressArgs): ChatStreamEvent {
  return { type: "express", args };
}

function usageEvent(
  input_tokens: number,
  output_tokens: number,
  total_tokens: number,
): ChatStreamEvent {
  return { type: "usage", usage: { input_tokens, output_tokens, total_tokens } };
}

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

let applyDirective: ReturnType<typeof vi.fn>;
let speechSink: ReturnType<typeof vi.fn>;
let cueSink: ReturnType<typeof vi.fn>;
let toolStatusSink: ReturnType<typeof vi.fn>;
let speechDeltaSink: ReturnType<typeof vi.fn>;
let speechEndSink: ReturnType<typeof vi.fn>;
let speechInterruptSink: ReturnType<typeof vi.fn>;
let speechAbortSink: ReturnType<typeof vi.fn>;
let usageSink: ReturnType<typeof vi.fn>;
let caller: BackendCaller;
let logger: Logger;

beforeEach(() => {
  scriptedEvents = [];
  streamChatError = null;
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

describe("backend_caller — B1 package_context (contract §4 InputContext)", () => {
  it("builds InputContext with user_text + env.timestamp + env.timezone and passes it to streamChat", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv("오늘 일정?"));
    expect(streamChatSpy).toHaveBeenCalledTimes(1);
    const [cfg, request] = streamChatSpy.mock.calls[0];
    expect(cfg).toEqual(CONFIG);
    // input must be an array carrying the user text (OpenAI Responses input shape).
    const json = JSON.stringify(request.input);
    expect(json).toContain("오늘 일정?");
  });

  it("passes apiKey + fetch from the injected resolvers to streamChat opts", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv());
    const [, , opts] = streamChatSpy.mock.calls[0];
    expect(opts.apiKey).toBe("k");
    expect("fetch" in opts).toBe(true);
  });

  it("threads an AbortSignal through the request", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv());
    const [, request] = streamChatSpy.mock.calls[0];
    expect(request.signal).toBeInstanceOf(AbortSignal);
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

  it("forwards tool_status to onToolStatus when present", async () => {
    const status = { state: "running" as const, tool_id: "web_search" };
    const env: ControlEnvelope = { speech_text: "", tool_status: status };
    scriptedEvents = [completedEvent(env)];
    await caller.call(userEnv());
    expect(toolStatusSink).toHaveBeenCalledWith(status);
  });
});

describe("backend_caller — screenshot port", () => {
  const SCREENSHOT: NonNullable<InputContext["screenshot"]> = {
    enabled: true,
    source: { kind: "monitor", index: 0 },
    data_url: "data:image/png;base64,AAA",
  };

  /** find the user message in the input passed to streamChat. */
  function userMessageOf(input: unknown): { role: string; content: unknown } {
    const items = input as Array<{ role: string; content: unknown }>;
    return items.find((m) => m.role === "user")!;
  }

  it("getScreenshot block → user content is array with input_text + input_image (data_url)", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      getScreenshot: async () => SCREENSHOT,
    });
    await caller.call(userEnv("이 화면 뭐야?"));
    const [, request] = streamChatSpy.mock.calls[0];
    const content = userMessageOf(request.input).content as Array<Record<string, unknown>>;
    expect(Array.isArray(content)).toBe(true);
    const textPart = content.find((p) => p.type === "input_text");
    expect(textPart?.text).toBe("이 화면 뭐야?");
    const imagePart = content.find((p) => p.type === "input_image");
    expect(imagePart?.image_url).toBe("data:image/png;base64,AAA");
  });

  it("getScreenshot omitted → user content is a plain string (unchanged)", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv("그냥 텍스트"));
    const [, request] = streamChatSpy.mock.calls[0];
    expect(userMessageOf(request.input).content).toBe("그냥 텍스트");
  });

  it("getScreenshot resolves undefined → user content is a plain string (no image part)", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      getScreenshot: async () => undefined,
    });
    await caller.call(userEnv("이미지 없음"));
    const [, request] = streamChatSpy.mock.calls[0];
    expect(userMessageOf(request.input).content).toBe("이미지 없음");
  });

  it("getScreenshot rejects → turn still proceeds without an image (reaches streamChat)", async () => {
    scriptedEvents = [completedEvent({ speech_text: "hi" })];
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      getScreenshot: async () => {
        throw new Error("capture failed");
      },
    });
    const res = await caller.call(userEnv("캡처 실패"));
    expect(res.ok).toBe(true);
    expect(streamChatSpy).toHaveBeenCalledTimes(1);
    const [, request] = streamChatSpy.mock.calls[0];
    expect(userMessageOf(request.input).content).toBe("캡처 실패");
  });
});

describe("backend_caller — os context port", () => {
  /** decode input_context.env from the §7.1 layered system hint passed to streamChat. */
  function envOf(input: unknown): Record<string, unknown> {
    const items = input as Array<{ role: string; content: string }>;
    const sys = items.find((m) => m.role === "system")!;
    const json = sys.content.replace(/^client_context:\s*/, "");
    const hint = JSON.parse(json) as { input_context: { env: Record<string, unknown> } };
    return hint.input_context.env;
  }

  it("getOsContext snapshot → env.active_app + env.active_window_title attached", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      getOsContext: () => ({ activeApp: "Visual Studio Code", activeWindowTitle: "main.ts" }),
    });
    await caller.call(userEnv());
    const [, request] = streamChatSpy.mock.calls[0];
    const env = envOf(request.input);
    expect(env.active_app).toEqual({ name: "Visual Studio Code" });
    expect(env.active_window_title).toBe("main.ts");
  });

  it("getOsContext absent → env.active_app / active_window_title omitted", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv());
    const [, request] = streamChatSpy.mock.calls[0];
    const env = envOf(request.input);
    expect("active_app" in env).toBe(false);
    expect("active_window_title" in env).toBe(false);
  });

  it("getOsContext returns {} → env.active_app / active_window_title omitted", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      getOsContext: () => ({}),
    });
    await caller.call(userEnv());
    const [, request] = streamChatSpy.mock.calls[0];
    const env = envOf(request.input);
    expect("active_app" in env).toBe(false);
    expect("active_window_title" in env).toBe(false);
  });
});

describe("backend_caller — §7.1 trigger / dispatcher_state envelope", () => {
  /** decode the full system-hint block { input_context, trigger, dispatcher_state }. */
  function hintOf(input: unknown): {
    input_context: { env: Record<string, unknown> } & Record<string, unknown>;
    trigger: Record<string, unknown>;
    dispatcher_state: Record<string, unknown>;
  } {
    const items = input as Array<{ role: string; content: string }>;
    const sys = items.find((m) => m.role === "system")!;
    const json = sys.content.replace(/^client_context:\s*/, "");
    return JSON.parse(json);
  }

  function userMessageContentOf(input: unknown): unknown {
    const items = input as Array<{ role: string; content: unknown }>;
    return items.find((m) => m.role === "user")!.content;
  }

  function proactiveEnv(): BusEnvelope {
    return {
      seq_id: 7,
      source: "timer_scheduler",
      event_name: "proactive.cowork",
      ts: 1_717_000_000_000,
      hint_tier: 2,
      payload: { os_idle_ms: 65_000 },
    };
  }

  it("(a) proactive envelope → trigger + dispatcher_state serialized; user message is the proactive marker", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    await caller.call(proactiveEnv());
    const [, request] = streamChatSpy.mock.calls[0];
    const hint = hintOf(request.input);
    expect(hint.trigger.event_name).toBe("proactive.cowork");
    expect(hint.trigger.source).toBe("timer_scheduler");
    expect(hint.trigger.seq_id).toBe(7);
    expect(hint.dispatcher_state.idle_seconds).toBe(65);
    expect(hint.dispatcher_state.tier_hint).toBe(2);
    // proactive turn (no user_text) → non-empty marker, not "".
    expect(userMessageContentOf(request.input)).toBe("(proactive: co-working check-in)");
  });

  it("(b) os snapshot isFullscreen=true → input_context.env.is_fullscreen===true", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      getOsContext: () => ({ isFullscreen: true }),
    });
    await caller.call(userEnv());
    const [, request] = streamChatSpy.mock.calls[0];
    const hint = hintOf(request.input);
    expect(hint.input_context.env.is_fullscreen).toBe(true);
  });

  it("(c) user turn with text → user message is the verbatim string (no marker)", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv("진짜 텍스트"));
    const [, request] = streamChatSpy.mock.calls[0];
    expect(userMessageContentOf(request.input)).toBe("진짜 텍스트");
  });
});

describe("backend_caller — agent settings (reasoning effort + instructions)", () => {
  it("getAgentSettings present → reasoning_effort + instructions threaded into ChatRequest", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      getAgentSettings: () => ({ reasoning_effort: "medium", instructions: "be terse" }),
    });
    await caller.call(userEnv());
    const [, request] = streamChatSpy.mock.calls[0];
    expect(request.reasoning_effort).toBe("medium");
    expect(request.instructions).toBe("be terse");
  });

  it("getAgentSettings 'default'/empty → no reasoning_effort, no instructions on the request", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      getAgentSettings: () => ({ reasoning_effort: "default", instructions: "" }),
    });
    await caller.call(userEnv());
    const [, request] = streamChatSpy.mock.calls[0];
    expect("reasoning_effort" in request).toBe(false);
    expect("instructions" in request).toBe(false);
  });

  it("getAgentSettings absent → request carries neither (back-compat)", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv());
    const [, request] = streamChatSpy.mock.calls[0];
    expect("reasoning_effort" in request).toBe(false);
    expect("instructions" in request).toBe(false);
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

// ── streaming TTS: speech_delta → onSpeechDelta / onSpeechEnd / onSpeechInterrupt ─

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
});

// ── structured logging ──────────────────────────────────────────────────────

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

// ── session id threading → streamChat opts.sessionId ───────────────────────────

describe("backend_caller — session id threading (X-Hermes-Session-Id)", () => {
  it("getSessionId present → streamChat opts carry sessionId", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      getSessionId: () => "sess-1",
    });
    await caller.call(userEnv());
    const [, , opts] = streamChatSpy.mock.calls[0];
    expect(opts.sessionId).toBe("sess-1");
  });

  it("getSessionId absent → streamChat opts.sessionId is undefined", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv());
    const [, , opts] = streamChatSpy.mock.calls[0];
    expect(opts.sessionId).toBeUndefined();
  });

  it("getSessionId returns undefined → streamChat opts.sessionId is undefined", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      getSessionId: () => undefined,
    });
    await caller.call(userEnv());
    const [, , opts] = streamChatSpy.mock.calls[0];
    expect(opts.sessionId).toBeUndefined();
  });

  it("reads the session id fresh each turn (not cached at construction)", async () => {
    let current = "sess-1";
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      getSessionId: () => current,
    });
    scriptedEvents = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv());
    current = "sess-2";
    await caller.call(userEnv());
    expect(streamChatSpy.mock.calls[0][2].sessionId).toBe("sess-1");
    expect(streamChatSpy.mock.calls[1][2].sessionId).toBe("sess-2");
  });
});

// ── usage event → onUsage diagnostic sink ──────────────────────────────────────

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
