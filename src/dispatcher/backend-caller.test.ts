/**
 * backend-caller.test.ts — Backend caller B1–B5 (event-dispatcher.md §7.2).
 *
 * Locks:
 *  - B1 package_context → contract §4 InputContext (user_text + env.timestamp + env.timezone).
 *  - B2 streamChat invocation with injected fetch + apiKey from secrets, AbortSignal threaded.
 *  - B3 consume chat-client `completed` event → ControlEnvelope (no SSE re-parse).
 *  - B4 speech gate by speech_text only (D-NO-SPEAK-GATE: empty = skip, no flag).
 *  - B5 dispatch_to_renderer → renderer.applyDirective(envelope) + speech_text → speech sink
 *       + emotion_text → onEmotionText + tool_status → onToolStatus (callbacks fire).
 *  - parse_error / network drop classification.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ControlEnvelope, EndpointsConfig, InputContext } from "../contract";
import type { ChatStreamEvent } from "../io/chat-client";
import type { BusEnvelope } from "./event-bus";
import type { Logger } from "../logger";

// ── streamChat mock (so we don't hit the SDK / network) ───────────────────────
let scriptedEvents: ChatStreamEvent[] = [];
let streamChatError: Error | null = null;
const streamChatSpy = vi.fn();

vi.mock("../io/chat-client", () => ({
  async *streamChat(...args: unknown[]) {
    streamChatSpy(...args);
    if (streamChatError) throw streamChatError;
    for (const ev of scriptedEvents) yield ev;
  },
}));

import { createBackendCaller, type BackendCaller } from "./backend-caller";

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

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

let applyDirective: ReturnType<typeof vi.fn>;
let speechSink: ReturnType<typeof vi.fn>;
let emotionTextSink: ReturnType<typeof vi.fn>;
let toolStatusSink: ReturnType<typeof vi.fn>;
let caller: BackendCaller;
let logger: Logger;

beforeEach(() => {
  scriptedEvents = [];
  streamChatError = null;
  streamChatSpy.mockClear();
  applyDirective = vi.fn();
  speechSink = vi.fn();
  emotionTextSink = vi.fn();
  toolStatusSink = vi.fn();
  logger = makeLogger();
  caller = createBackendCaller({
    config: CONFIG,
    renderer: { applyDirective } as never,
    getApiKey: async () => "k",
    getFetch: async () => undefined,
    onSpeech: speechSink,
    onEmotionText: emotionTextSink,
    onToolStatus: toolStatusSink,
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

describe("backend_caller — B4 speech gate (D-NO-SPEAK-GATE: speech_text only)", () => {
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

describe("backend_caller — B5 emotion_text + tool_status callbacks", () => {
  it("forwards emotion_text to onEmotionText when present", async () => {
    const env: ControlEnvelope = {
      speech_text: "안녕",
      emotion: { id: "happy" },
      emotion_text: "[whisper in small voice]",
    };
    scriptedEvents = [completedEvent(env)];
    await caller.call(userEnv());
    expect(emotionTextSink).toHaveBeenCalledWith("[whisper in small voice]");
  });

  it("does not call onEmotionText when emotion_text is absent", async () => {
    const env: ControlEnvelope = { speech_text: "안녕", emotion: { id: "happy" } };
    scriptedEvents = [completedEvent(env)];
    await caller.call(userEnv());
    expect(emotionTextSink).not.toHaveBeenCalled();
  });

  it("forwards tool_status to onToolStatus when present", async () => {
    const status = { state: "running" as const, tool_id: "web_search" };
    const env: ControlEnvelope = { speech_text: "", tool_status: status };
    scriptedEvents = [completedEvent(env)];
    await caller.call(userEnv());
    expect(toolStatusSink).toHaveBeenCalledWith(status);
  });
});

describe("backend_caller — screenshot port (#20)", () => {
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

describe("backend_caller — os context port (#18)", () => {
  /** decode the system message env block passed to streamChat. */
  function envOf(input: unknown): Record<string, unknown> {
    const items = input as Array<{ role: string; content: string }>;
    const sys = items.find((m) => m.role === "system")!;
    const json = sys.content.replace(/^client_context:\s*/, "");
    return JSON.parse(json) as Record<string, unknown>;
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

// ── #76 structured logging ─────────────────────────────────────────────────────

describe("backend_caller — structured logging (#76)", () => {
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
    applyDirective = vi.fn(() => { throw new Error("renderer boom"); });
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
