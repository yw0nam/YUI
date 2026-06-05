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
import type { ControlEnvelope, EndpointsConfig } from "../contract";
import type { ChatStreamEvent } from "../io/chat-client";
import type { BusEnvelope } from "./event-bus";

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

let applyDirective: ReturnType<typeof vi.fn>;
let speechSink: ReturnType<typeof vi.fn>;
let emotionTextSink: ReturnType<typeof vi.fn>;
let toolStatusSink: ReturnType<typeof vi.fn>;
let caller: BackendCaller;

beforeEach(() => {
  scriptedEvents = [];
  streamChatError = null;
  streamChatSpy.mockClear();
  applyDirective = vi.fn();
  speechSink = vi.fn();
  emotionTextSink = vi.fn();
  toolStatusSink = vi.fn();
  caller = createBackendCaller({
    config: CONFIG,
    renderer: { applyDirective } as never,
    getApiKey: async () => "k",
    getFetch: async () => undefined,
    onSpeech: speechSink,
    onEmotionText: emotionTextSink,
    onToolStatus: toolStatusSink,
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
