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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ControlEnvelope, EndpointsConfig, ExpressArgs, InputContext } from "../contract";
import type { ChatStreamEvent } from "../io/chat-client";
import type { ChatHistoryEntry } from "../io/chat-history-store";
import type { Logger } from "../logger";
import type { BusEnvelope } from "./event-bus";

// ── streamChat mock (so we don't hit the SDK / network) ───────────────────────
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

function completedEvent(env: ControlEnvelope, responseId = "resp_new"): ChatStreamEvent {
  return { type: "completed", envelope: env, responseId };
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

  it("env.timestamp is a local ISO 8601 string with timezone offset representing the same instant as env.ts", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    const TS = 1_717_000_000_000;
    await caller.call(userEnv("now?"));
    const [, request] = streamChatSpy.mock.calls[0];
    const items = request.input as Array<{ role: string; content: string }>;
    const sys = items.find((m) => m.role === "system")!;
    const ctx = JSON.parse(sys.content.replace(/^client_context:\s*/, "")) as {
      env: { timestamp: string };
    };
    const ts = ctx.env.timestamp;
    // local wall-clock form with explicit ±HH:MM offset (not UTC "…Z").
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    // combined with its offset it must denote the same instant as env.ts.
    expect(new Date(ts).getTime()).toBe(TS);
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

describe("backend_caller — user_images (chat attachments)", () => {
  const IMG_A = "data:image/png;base64,AAA";
  const IMG_B = "data:image/jpeg;base64,BBB";

  /** find the user message in the input passed to streamChat. */
  function userMessageOf(input: unknown): { role: string; content: unknown } {
    const items = input as Array<{ role: string; content: unknown }>;
    return items.find((m) => m.role === "user")!;
  }

  /** the raw system message string passed to streamChat. */
  function systemStringOf(input: unknown): string {
    const items = input as Array<{ role: string; content: string }>;
    return items.find((m) => m.role === "system")!.content;
  }

  function imgEnv(text: string, images: string[]): BusEnvelope {
    return { ...userEnv(text), payload: { text, images } };
  }

  it("payload.images → user content carries one input_image part per image + input_text", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    await caller.call(imgEnv("이거 봐", [IMG_A, IMG_B]));
    const [, request] = streamChatSpy.mock.calls[0];
    const content = userMessageOf(request.input).content as Array<Record<string, unknown>>;
    expect(Array.isArray(content)).toBe(true);
    expect(content.find((p) => p.type === "input_text")?.text).toBe("이거 봐");
    const images = content.filter((p) => p.type === "input_image");
    expect(images.map((p) => p.image_url)).toEqual([IMG_A, IMG_B]);
  });

  it("image data URLs are absent from the system client_context string", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    await caller.call(imgEnv("이거 봐", [IMG_A, IMG_B]));
    const [, request] = streamChatSpy.mock.calls[0];
    const sys = systemStringOf(request.input);
    expect(sys).not.toContain(IMG_A);
    expect(sys).not.toContain(IMG_B);
  });

  it("screenshot + user_images together → screenshot part AND all user image parts present", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    const SHOT = "data:image/png;base64,SHOT";
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      getScreenshot: async () => ({
        enabled: true,
        source: { kind: "monitor", index: 0 },
        data_url: SHOT,
      }),
    });
    await caller.call(imgEnv("둘 다", [IMG_A, IMG_B]));
    const [, request] = streamChatSpy.mock.calls[0];
    const content = userMessageOf(request.input).content as Array<Record<string, unknown>>;
    const urls = content.filter((p) => p.type === "input_image").map((p) => p.image_url);
    expect(urls).toEqual([SHOT, IMG_A, IMG_B]);
  });

  it("no images and no screenshot → user content stays a plain string", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv("그냥 텍스트"));
    const [, request] = streamChatSpy.mock.calls[0];
    expect(userMessageOf(request.input).content).toBe("그냥 텍스트");
  });
});

describe("backend_caller — os context port", () => {
  /** decode the flat ClientContext from the system message passed to streamChat. */
  function clientContextOf(input: unknown): Record<string, unknown> {
    const items = input as Array<{ role: string; content: string }>;
    const sys = items.find((m) => m.role === "system")!;
    const json = sys.content.replace(/^client_context:\s*/, "");
    return JSON.parse(json);
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
    const ctx = clientContextOf(request.input);
    const env = ctx.env as Record<string, unknown>;
    expect(env.active_app).toEqual({ name: "Visual Studio Code" });
    expect(env.active_window_title).toBe("main.ts");
  });

  it("getOsContext absent → env.active_app / active_window_title omitted", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv());
    const [, request] = streamChatSpy.mock.calls[0];
    const ctx = clientContextOf(request.input);
    const env = ctx.env as Record<string, unknown>;
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
    const ctx = clientContextOf(request.input);
    const env = ctx.env as Record<string, unknown>;
    expect("active_app" in env).toBe(false);
    expect("active_window_title" in env).toBe(false);
  });
});

describe("backend_caller — flat client_context envelope", () => {
  /** decode the flat ClientContext { env, trigger, screenshot? } from the system message. */
  function clientContextOf(input: unknown): Record<string, unknown> {
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
      payload: { os_idle_ms: 65_000, gap_ms: 3_900_000 },
    };
  }

  it("(a) proactive envelope → flat trigger with kind/idle_elapsed_min; NO input_context/dispatcher_state; user message is proactive marker", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    await caller.call(proactiveEnv());
    const [, request] = streamChatSpy.mock.calls[0];
    const ctx = clientContextOf(request.input);
    // top-level keys: env + trigger only (no input_context, no dispatcher_state)
    expect("input_context" in ctx).toBe(false);
    expect("dispatcher_state" in ctx).toBe(false);
    // trigger must have kind derived from event_name
    const trigger = ctx.trigger as Record<string, unknown>;
    expect(trigger.kind).toBe("proactive");
    // idle_elapsed_min = round(3_900_000 / 60000) = 65
    expect(trigger.idle_elapsed_min).toBe(65);
    // no raw event_name/source/ts/seq_id on trigger
    expect("event_name" in trigger).toBe(false);
    expect("source" in trigger).toBe(false);
    expect("ts" in trigger).toBe(false);
    expect("seq_id" in trigger).toBe(false);
    // proactive turn (no user_text) → proactive marker string
    expect(userMessageContentOf(request.input)).toBe("(proactive trigger)");
  });

  it("(b) user turn → trigger.kind is 'user'; env has timestamp/timezone; no user_text in system object", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv("진짜 텍스트"));
    const [, request] = streamChatSpy.mock.calls[0];
    const ctx = clientContextOf(request.input);
    const trigger = ctx.trigger as Record<string, unknown>;
    expect(trigger.kind).toBe("user");
    expect("idle_elapsed_min" in trigger).toBe(false);
    // env has timestamp + timezone
    const env = ctx.env as Record<string, unknown>;
    expect(typeof env.timestamp).toBe("string");
    expect(typeof env.timezone).toBe("string");
    // NO user text in system object anywhere
    const serialized = JSON.stringify(ctx);
    expect(serialized).not.toContain("진짜 텍스트");
    // user text appears in the user-role message
    expect(userMessageContentOf(request.input)).toBe("진짜 텍스트");
  });

  it("(c) schedule envelope → trigger.kind is 'schedule'", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    const env: BusEnvelope = {
      seq_id: 5,
      source: "timer_scheduler",
      event_name: "schedule.morning",
      ts: 1_717_000_000_000,
      hint_tier: 2,
      payload: {},
    };
    await caller.call(env);
    const [, request] = streamChatSpy.mock.calls[0];
    const ctx = clientContextOf(request.input);
    const trigger = ctx.trigger as Record<string, unknown>;
    expect(trigger.kind).toBe("schedule");
    expect("idle_elapsed_min" in trigger).toBe(false);
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

  it("getAgentSettings 'none' → reasoning_effort always sent; empty instructions omitted", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      getAgentSettings: () => ({ reasoning_effort: "none", instructions: "" }),
    });
    await caller.call(userEnv());
    const [, request] = streamChatSpy.mock.calls[0];
    expect(request.reasoning_effort).toBe("none");
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

  it("no first byte within IDLE_TIMEOUT_MS (TTFT stall) → aborts the request and drops network_drop", async () => {
    hangAtIndex = 0;
    scriptedEvents = [];
    const p = caller.call(userEnv());
    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS);
    const res = await p;
    expect(res.ok).toBe(false);
    expect(res.drop_reason).toBe("network_drop");
    const [, request] = streamChatSpy.mock.calls[0];
    expect((request.signal as AbortSignal).aborted).toBe(true);
  });

  it("stall after ≥1 delta (mid-stream stall) → aborts, drops network_drop, tears down via onSpeechAbort", async () => {
    scriptedEvents = [deltaEvent("partial")];
    hangAtIndex = 1;
    const p = caller.call(userEnv());
    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS);
    const res = await p;
    expect(res.ok).toBe(false);
    expect(res.drop_reason).toBe("network_drop");
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

  it("logs logger.warn('network_drop', { stage: 'idle_timeout', ... }) on expiry", async () => {
    hangAtIndex = 0;
    scriptedEvents = [];
    const p = caller.call(userEnv());
    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS);
    await p;
    expect(logger.warn).toHaveBeenCalledWith(
      "network_drop",
      expect.objectContaining({ stage: "idle_timeout" }),
    );
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

// ── previous_response_id threading (OpenAI Responses conversation state) ────────

describe("backend_caller — previous_response_id threading", () => {
  it("getPreviousResponseId present → request.previous_response_id carries it", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      getPreviousResponseId: () => "resp_prev",
    });
    await caller.call(userEnv());
    const [, request] = streamChatSpy.mock.calls[0];
    expect(request.previous_response_id).toBe("resp_prev");
  });

  it("getPreviousResponseId returns undefined → no previous_response_id (first turn)", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      getPreviousResponseId: () => undefined,
    });
    await caller.call(userEnv());
    const [, request] = streamChatSpy.mock.calls[0];
    expect("previous_response_id" in request).toBe(false);
  });

  it("getPreviousResponseId absent → no previous_response_id (back-compat)", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv());
    const [, request] = streamChatSpy.mock.calls[0];
    expect("previous_response_id" in request).toBe(false);
  });

  it("successful completed turn → onResponseId called once with the completed responseId", async () => {
    const onResponseId = vi.fn();
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      getPreviousResponseId: () => undefined,
      onResponseId,
    });
    scriptedEvents = [completedEvent({ speech_text: "hi" }, "resp_123")];
    await caller.call(userEnv());
    expect(onResponseId).toHaveBeenCalledTimes(1);
    expect(onResponseId).toHaveBeenCalledWith("resp_123");
  });

  it("aborted turn → onResponseId NOT called", async () => {
    const onResponseId = vi.fn();
    const ac = new AbortController();
    ac.abort();
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      onResponseId,
    });
    scriptedEvents = [completedEvent({ speech_text: "hi" }, "resp_123")];
    await caller.call(userEnv(), ac.signal);
    expect(onResponseId).not.toHaveBeenCalled();
  });

  it("error event turn → onResponseId NOT called", async () => {
    const onResponseId = vi.fn();
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      onResponseId,
    });
    scriptedEvents = [{ type: "error", message: "boom" }];
    await caller.call(userEnv());
    expect(onResponseId).not.toHaveBeenCalled();
  });

  it("no completed envelope (parse_error) → onResponseId NOT called", async () => {
    const onResponseId = vi.fn();
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      onResponseId,
    });
    scriptedEvents = [deltaEvent("x")];
    await caller.call(userEnv());
    expect(onResponseId).not.toHaveBeenCalled();
  });

  it("R2 race: previous id changed mid-stream (reset) → onResponseId NOT called", async () => {
    const onResponseId = vi.fn();
    let current: string | undefined = "resp_prev";
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      // settings-window reset rotates the id while the turn is in flight.
      getPreviousResponseId: () => current,
      onResponseId,
    });
    // The reset lands via onSpeech (any callback firing before the post-stream snapshot check
    // works — single-threaded, so there's no TOCTOU window): start-time id "resp_prev" no longer
    // matches at completion, so the dead turn's id must not overwrite the rotated store.
    speechSink.mockImplementation(() => {
      current = "resp_rotated";
    });
    scriptedEvents = [completedEvent({ speech_text: "hi" }, "resp_123")];
    await caller.call(userEnv());
    expect(onResponseId).not.toHaveBeenCalled();
  });
});

// ── cue context forwarding (schedule / proactive payloads → trigger.cue) ──────

describe("backend_caller — cue context forwarding (trigger.cue)", () => {
  /** decode the flat ClientContext from the system message. */
  function clientContextOf(input: unknown): Record<string, unknown> {
    const items = input as Array<{ role: string; content: string }>;
    const sys = items.find((m) => m.role === "system")!;
    const json = sys.content.replace(/^client_context:\s*/, "");
    return JSON.parse(json);
  }

  it("(a) schedule envelope with cue → trigger.cue has label/context/local_time, NO id; schedule user message is proactive marker", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    const env: BusEnvelope = {
      seq_id: 10,
      source: "timer_scheduler",
      event_name: "schedule.morning",
      ts: 1_717_000_000_000,
      hint_tier: 2,
      payload: {
        cue_id: "morning",
        label: "아침",
        context: "아침 인사 + 오늘 일정 리마인드",
        local_time: "09:00",
      },
    };
    await caller.call(env);
    const [, request] = streamChatSpy.mock.calls[0];
    const ctx = clientContextOf(request.input);
    const trigger = ctx.trigger as Record<string, unknown>;
    expect(trigger.kind).toBe("schedule");
    expect(trigger.cue).toEqual({
      label: "아침",
      context: "아침 인사 + 오늘 일정 리마인드",
      local_time: "09:00",
    });
    // no id on cue
    expect((trigger.cue as Record<string, unknown>).id).toBeUndefined();
    expect((trigger.cue as Record<string, unknown>).idle_min).toBeUndefined();
    // idle_elapsed_min absent (no gap_ms on this envelope)
    expect("idle_elapsed_min" in trigger).toBe(false);
    // user message is the proactive marker (no user text for schedule/proactive)
    const userMsg = (request.input as Array<{ role: string; content: unknown }>).find(
      (m) => m.role === "user",
    )!;
    expect(userMsg.content).toBe("(proactive trigger)");
  });

  it("(b) proactive envelope with cue → trigger.cue has label/context/idle_min, NO id/local_time; idle_elapsed_min on trigger", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    const env: BusEnvelope = {
      seq_id: 11,
      source: "timer_scheduler",
      event_name: "proactive.cowork",
      ts: 1_717_000_000_000,
      hint_tier: 2,
      payload: {
        cue_id: "cowork",
        label: "코워킹",
        context: "집중 근무 중 따뜻하게 말 걸기",
        idle_min: 10,
        gap_ms: 3_600_000,
      },
    };
    await caller.call(env);
    const [, request] = streamChatSpy.mock.calls[0];
    const ctx = clientContextOf(request.input);
    const trigger = ctx.trigger as Record<string, unknown>;
    expect(trigger.kind).toBe("proactive");
    expect(trigger.cue).toEqual({
      label: "코워킹",
      context: "집중 근무 중 따뜻하게 말 걸기",
      idle_min: 10,
    });
    expect((trigger.cue as Record<string, unknown>).id).toBeUndefined();
    expect((trigger.cue as Record<string, unknown>).local_time).toBeUndefined();
    // idle_elapsed_min = round(3_600_000 / 60000) = 60
    expect(trigger.idle_elapsed_min).toBe(60);
  });

  it("(c) user.text_submitted envelope (no cue_id) → trigger.cue absent", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv("안녕"));
    const [, request] = streamChatSpy.mock.calls[0];
    const ctx = clientContextOf(request.input);
    const trigger = ctx.trigger as Record<string, unknown>;
    expect("cue" in trigger).toBe(false);
    expect("idle_elapsed_min" in trigger).toBe(false);
  });
});

// ── github PR transitions (github.* payloads → trigger.kind/pr/pr_catchup) ──────

describe("backend_caller — github PR trigger forwarding", () => {
  /** decode the flat ClientContext from the system message. */
  function clientContextOf(input: unknown): Record<string, unknown> {
    const items = input as Array<{ role: string; content: string }>;
    const sys = items.find((m) => m.role === "system")!;
    const json = sys.content.replace(/^client_context:\s*/, "");
    return JSON.parse(json);
  }

  it("(a) github.ci_failed → trigger.kind 'github' + trigger.pr; user message is proactive marker", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    const env: BusEnvelope = {
      seq_id: 20,
      source: "timer_scheduler",
      event_name: "github.ci_failed",
      ts: 1_717_000_000_000,
      hint_tier: 2,
      payload: {
        repo: "acme/widgets",
        number: 42,
        title: "Add gizmo",
        url: "https://github.com/acme/widgets/pull/42",
        event: "ci_failed",
        from: "PENDING",
        to: "FAILURE",
      },
    };
    await caller.call(env);
    const [, request] = streamChatSpy.mock.calls[0];
    const ctx = clientContextOf(request.input);
    const trigger = ctx.trigger as Record<string, unknown>;
    expect(trigger.kind).toBe("github");
    expect(trigger.pr).toEqual({
      repo: "acme/widgets",
      number: 42,
      title: "Add gizmo",
      url: "https://github.com/acme/widgets/pull/42",
      event: "ci_failed",
      from: "PENDING",
      to: "FAILURE",
    });
    expect("pr_catchup" in trigger).toBe(false);
    const userMsg = (request.input as Array<{ role: string; content: unknown }>).find(
      (m) => m.role === "user",
    )!;
    expect(userMsg.content).toBe("(proactive trigger)");
  });

  it("(b) github.review_changes → trigger.pr.from may be null", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    const env: BusEnvelope = {
      seq_id: 21,
      source: "timer_scheduler",
      event_name: "github.review_changes",
      ts: 1_717_000_000_000,
      hint_tier: 2,
      payload: {
        repo: "acme/widgets",
        number: 7,
        title: "Refactor",
        url: "https://github.com/acme/widgets/pull/7",
        event: "review_changes",
        from: null,
        to: "CHANGES_REQUESTED",
      },
    };
    await caller.call(env);
    const [, request] = streamChatSpy.mock.calls[0];
    const trigger = clientContextOf(request.input).trigger as Record<string, unknown>;
    expect(trigger.kind).toBe("github");
    expect((trigger.pr as Record<string, unknown>).from).toBeNull();
    expect((trigger.pr as Record<string, unknown>).to).toBe("CHANGES_REQUESTED");
  });

  it("(c) github.catchup → trigger.pr_catchup with prs/transitions; no trigger.pr", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    const env: BusEnvelope = {
      seq_id: 22,
      source: "timer_scheduler",
      event_name: "github.catchup",
      ts: 1_717_000_000_000,
      hint_tier: 2,
      payload: {
        prs: [
          {
            repo: "acme/widgets",
            number: 42,
            title: "Add gizmo",
            url: "https://github.com/acme/widgets/pull/42",
            transitions: [
              { kind: "ci", from: "PENDING", to: "FAILURE", ts: 1_717_000_000_000 },
              { kind: "review", from: null, to: "APPROVED", ts: 1_717_000_001_000 },
            ],
          },
        ],
      },
    };
    await caller.call(env);
    const [, request] = streamChatSpy.mock.calls[0];
    const trigger = clientContextOf(request.input).trigger as Record<string, unknown>;
    expect(trigger.kind).toBe("github");
    expect("pr" in trigger).toBe(false);
    expect(trigger.pr_catchup).toEqual({
      prs: [
        {
          repo: "acme/widgets",
          number: 42,
          title: "Add gizmo",
          url: "https://github.com/acme/widgets/pull/42",
          transitions: [
            { kind: "ci", from: "PENDING", to: "FAILURE", ts: 1_717_000_000_000 },
            { kind: "review", from: null, to: "APPROVED", ts: 1_717_000_001_000 },
          ],
        },
      ],
    });
  });

  it("(d) github.* with malformed payload (missing fields) → kind 'github' but no pr/pr_catchup", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    const env: BusEnvelope = {
      seq_id: 23,
      source: "timer_scheduler",
      event_name: "github.ci_failed",
      ts: 1_717_000_000_000,
      hint_tier: 2,
      payload: { repo: "acme/widgets", number: "not-a-number" },
    };
    await caller.call(env);
    const [, request] = streamChatSpy.mock.calls[0];
    const trigger = clientContextOf(request.input).trigger as Record<string, unknown>;
    expect(trigger.kind).toBe("github");
    expect("pr" in trigger).toBe(false);
    expect("pr_catchup" in trigger).toBe(false);
  });
});

// ── agent completion triggers (agent.* payloads → trigger.kind/agent/agent_catchup) ──

describe("backend_caller — agent trigger forwarding", () => {
  /** decode the flat ClientContext from the system message. */
  function clientContextOf(input: unknown): Record<string, unknown> {
    const items = input as Array<{ role: string; content: string }>;
    const sys = items.find((m) => m.role === "system")!;
    const json = sys.content.replace(/^client_context:\s*/, "");
    return JSON.parse(json);
  }

  it("(a) agent.done → trigger.kind 'agent' + trigger.agent; user message is proactive marker", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    const env: BusEnvelope = {
      seq_id: 30,
      source: "timer_scheduler",
      event_name: "agent.done",
      ts: 1_717_000_000_000,
      hint_tier: 2,
      payload: {
        tool: "claude-code",
        project: "my-widget",
        cwd: "/home/user/my-widget",
        status: "success",
        summary: "Implemented the gizmo feature",
        ts: 1_717_000_000_000,
      },
    };
    await caller.call(env);
    const [, request] = streamChatSpy.mock.calls[0];
    const ctx = clientContextOf(request.input);
    const trigger = ctx.trigger as Record<string, unknown>;
    expect(trigger.kind).toBe("agent");
    expect(trigger.agent).toEqual({
      tool: "claude-code",
      project: "my-widget",
      cwd: "/home/user/my-widget",
      status: "success",
      summary: "Implemented the gizmo feature",
      ts: 1_717_000_000_000,
    });
    expect("agent_catchup" in trigger).toBe(false);
    const userMsg = (request.input as Array<{ role: string; content: unknown }>).find(
      (m) => m.role === "user",
    )!;
    expect(userMsg.content).toBe("(proactive trigger)");
  });

  it("(b) agent.done without status → trigger.agent.status absent", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    const env: BusEnvelope = {
      seq_id: 31,
      source: "timer_scheduler",
      event_name: "agent.done",
      ts: 1_717_000_000_000,
      hint_tier: 2,
      payload: {
        tool: "opencode",
        project: "api",
        cwd: "/home/user/api",
        summary: "Refactored the handler",
        ts: 1_717_000_000_000,
      },
    };
    await caller.call(env);
    const [, request] = streamChatSpy.mock.calls[0];
    const trigger = clientContextOf(request.input).trigger as Record<string, unknown>;
    expect(trigger.kind).toBe("agent");
    expect("status" in (trigger.agent as Record<string, unknown>)).toBe(false);
  });

  it("(c) agent.catchup → trigger.agent_catchup with count+items; no trigger.agent", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    const env: BusEnvelope = {
      seq_id: 32,
      source: "timer_scheduler",
      event_name: "agent.catchup",
      ts: 1_717_000_000_000,
      hint_tier: 2,
      payload: {
        count: 2,
        items: [
          {
            tool: "claude-code",
            project: "alpha",
            status: "success",
            summary: "Done with alpha",
            ts: 1_717_000_000_000,
          },
          {
            tool: "opencode",
            project: "beta",
            summary: "Done with beta",
            ts: 1_717_000_001_000,
          },
        ],
      },
    };
    await caller.call(env);
    const [, request] = streamChatSpy.mock.calls[0];
    const trigger = clientContextOf(request.input).trigger as Record<string, unknown>;
    expect(trigger.kind).toBe("agent");
    expect("agent" in trigger).toBe(false);
    expect(trigger.agent_catchup).toEqual({
      count: 2,
      items: [
        {
          tool: "claude-code",
          project: "alpha",
          status: "success",
          summary: "Done with alpha",
          ts: 1_717_000_000_000,
        },
        {
          tool: "opencode",
          project: "beta",
          summary: "Done with beta",
          ts: 1_717_000_001_000,
        },
      ],
    });
  });

  it("(d) agent.done with malformed payload → kind 'agent' but no trigger.agent", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    const env: BusEnvelope = {
      seq_id: 33,
      source: "timer_scheduler",
      event_name: "agent.done",
      ts: 1_717_000_000_000,
      hint_tier: 2,
      payload: { tool: 42 }, // tool is not a string
    };
    await caller.call(env);
    const [, request] = streamChatSpy.mock.calls[0];
    const trigger = clientContextOf(request.input).trigger as Record<string, unknown>;
    expect(trigger.kind).toBe("agent");
    expect("agent" in trigger).toBe(false);
    expect("agent_catchup" in trigger).toBe(false);
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

// ── TTFT thinking lifecycle (filler) ──────────────────────────────────────────
// First line is immediate (no threshold): startThinking() runs synchronously at
// call entry when filler is active. Thinking ends only when real response speech
// begins (first speech_delta) — it persists through usage/express/tool_status that
// precede speech. Silent/error/abort turns still end thinking via finally.

describe("backend_caller — TTFT thinking lifecycle", () => {
  let onThinkingStart: ReturnType<typeof vi.fn>;
  let onThinkingEnd: ReturnType<typeof vi.fn>;
  let getFiller: ReturnType<typeof vi.fn>;

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

describe("backend_caller — Chat Completions (CC) mode request shape", () => {
  const CC_CONFIG: EndpointsConfig = { ...CONFIG, chat_api: "chat_completions" };

  function messagesOf(request: any): Array<{ role: string; content: unknown }> {
    return request.messages;
  }

  it("builds request.messages (system client_context + transcript + user); no tools/previous_response_id/instructions", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" }, "")];
    const transcriptEntries: ChatHistoryEntry[] = [
      { role: "user", text: "이전 질문", ts: 1 },
      { role: "assistant", text: "이전 답변", ts: 2 },
    ];
    caller = createBackendCaller({
      config: CC_CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      transcript: { get: () => transcriptEntries, append: vi.fn() },
    });
    await caller.call(userEnv("오늘 뭐해?"));
    const [, request] = streamChatSpy.mock.calls[0];
    const msgs = messagesOf(request);
    expect(Array.isArray(msgs)).toBe(true);
    expect(
      msgs.some(
        (m) =>
          m.role === "system" &&
          typeof m.content === "string" &&
          m.content.startsWith("client_context:"),
      ),
    ).toBe(true);
    expect(msgs).toEqual(
      expect.arrayContaining([
        { role: "user", content: "이전 질문" },
        { role: "assistant", content: "이전 답변" },
      ]),
    );
    expect(msgs[msgs.length - 1]).toEqual({ role: "user", content: "오늘 뭐해?" });
    expect("tools" in request).toBe(false);
    expect("previous_response_id" in request).toBe(false);
    expect("instructions" in request).toBe(false);
  });

  it("no transcript dep → messages still built with empty transcript (no crash)", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" }, "")];
    caller = createBackendCaller({
      config: CC_CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
    });
    const res = await caller.call(userEnv("혼자"));
    expect(res.ok).toBe(true);
    const [, request] = streamChatSpy.mock.calls[0];
    const msgs = messagesOf(request);
    expect(msgs[msgs.length - 1]).toEqual({ role: "user", content: "혼자" });
  });

  it("agent instructions override → leading system message carries it", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" }, "")];
    caller = createBackendCaller({
      config: CC_CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      getAgentSettings: () => ({ reasoning_effort: "medium", instructions: "be terse" }),
    });
    await caller.call(userEnv());
    const [, request] = streamChatSpy.mock.calls[0];
    expect(request.reasoning_effort).toBe("medium");
    expect(messagesOf(request)[0]).toEqual({ role: "system", content: "be terse" });
    expect("instructions" in request).toBe(false);
  });

  it("empty agent instructions → falls back to config.chat_instructions", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" }, "")];
    caller = createBackendCaller({
      config: { ...CC_CONFIG, chat_instructions: "config nudge" },
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      getAgentSettings: () => ({ reasoning_effort: "none", instructions: "" }),
    });
    await caller.call(userEnv());
    const [, request] = streamChatSpy.mock.calls[0];
    expect(messagesOf(request)[0]).toEqual({ role: "system", content: "config nudge" });
  });

  it("proactive turn in CC mode → user message is the proactive marker", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" }, "")];
    caller = createBackendCaller({
      config: CC_CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
    });
    const env: BusEnvelope = {
      seq_id: 50,
      source: "timer_scheduler",
      event_name: "proactive.cowork",
      ts: 1_717_000_000_000,
      hint_tier: 2,
      payload: {},
    };
    await caller.call(env);
    const [, request] = streamChatSpy.mock.calls[0];
    const msgs = messagesOf(request);
    expect(msgs[msgs.length - 1]).toEqual({ role: "user", content: "(proactive trigger)" });
  });
});

// ── transcript recording (both protocol modes) ──────────────────────────────

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
