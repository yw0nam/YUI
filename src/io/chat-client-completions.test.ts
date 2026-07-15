/**
 * chat-client-completions.test.ts — streamChat's Chat Completions branch.
 *
 * Verifies that when config.chat_api === "chat_completions", streamChat calls
 *   client.chat.completions.create({ stream: true, stream_options: { include_usage: true } })
 * exactly once (no tools, no round trip) and maps the `chat.completion.chunk` stream to
 * ChatStreamEvent via chat-completions.ts's createChunkReducer. generate_express is a
 * ONE-WAY cue emitted by the server (backend agent) — the client declares no tool, only parses,
 * and never sends the result back.
 *
 * Same principle as D-CHAT-SDK: do not mock fetch/SSE. Mock the `openai` module.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { EndpointsConfig } from "../contract";
import { type ChatRequest, type ChatStreamEvent, streamChat } from "./chat-client";

// ── openai SDK mock — chat.completions.create only (Responses branch untouched) ──
const ccCreateMock = vi.fn();
vi.mock("openai", () => ({
  default: vi.fn(() => ({ chat: { completions: { create: ccCreateMock } } })),
}));

afterEach(() => vi.clearAllMocks());

// ── helpers ──────────────────────────────────────────────────────────────────

async function* streamOf(chunks: any[]): AsyncGenerator<any> {
  for (const c of chunks) yield c;
}

async function collect(gen: AsyncGenerator<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const out: ChatStreamEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

const CONFIG: EndpointsConfig = {
  chat_base_url: "http://localhost:8643/v1",
  chat_endpoint: "/v1/responses",
  chat_model: "test-model",
  chat_api: "chat_completions",
  stt_base_url: "http://localhost:5517",
  tts_base_url: "http://localhost:8092",
};

const req = (over: Partial<ChatRequest> = {}): ChatRequest => ({
  input: undefined,
  messages: [{ role: "user", content: "hi" }],
  ...over,
});

// ── chunk fixtures (chat.completion.chunk shape) ──────────────────────────────

const textChunk = (content: string): any => ({
  choices: [{ index: 0, delta: { content }, finish_reason: null }],
});

const finishChunk = (reason: string): any => ({
  choices: [{ index: 0, delta: {}, finish_reason: reason }],
});

const usageChunk = (usage: Record<string, unknown>): any => ({ choices: [], usage });

const toolCallStart = (index: number, id: string, name: string, args = ""): any => ({
  choices: [
    {
      index: 0,
      delta: {
        tool_calls: [{ index, id, type: "function", function: { name, arguments: args } }],
      },
      finish_reason: null,
    },
  ],
});

const toolCallArgs = (index: number, args: string): any => ({
  choices: [
    {
      index: 0,
      delta: { tool_calls: [{ index, function: { arguments: args } }] },
      finish_reason: null,
    },
  ],
});

const GEN_EXPRESS_ARGS =
  '{"emotion_id":"happy","motion_id":"embarrassed","emotion_text":"[whisper]"}';

// ─────────────────────────────────────────────────────────────────────────────
// text-only turn
// ─────────────────────────────────────────────────────────────────────────────

describe("streamChat — Chat Completions text streaming", () => {
  it("maps delta.content chunks -> speech_delta, finish_reason stop -> speech_done + completed", async () => {
    ccCreateMock.mockResolvedValueOnce(
      streamOf([textChunk("Hello"), textChunk(" world"), finishChunk("stop")]),
    );

    const events = await collect(streamChat(CONFIG, req()));

    expect(events).toEqual([
      { type: "speech_delta", text: "Hello" },
      { type: "speech_delta", text: " world" },
      { type: "speech_done", text: "Hello world" },
      { type: "completed", envelope: { speech_text: "Hello world" }, responseId: "" },
    ]);
    expect(ccCreateMock).toHaveBeenCalledOnce();
  });

  it("calls chat.completions.create with messages/stream/stream_options verbatim; no tools field", async () => {
    ccCreateMock.mockResolvedValueOnce(streamOf([finishChunk("stop")]));
    const messages = [{ role: "user", content: "hi" }] as any;

    await collect(streamChat(CONFIG, req({ messages })));

    const [body, options] = ccCreateMock.mock.calls[0];
    expect(body.model).toBe("test-model");
    expect(body.messages).toEqual(messages);
    expect(body.tools).toBeUndefined();
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(options?.signal).toBeUndefined();
  });

  it("sends top-level reasoning_effort only when request.reasoning_effort is set", async () => {
    ccCreateMock.mockResolvedValueOnce(streamOf([finishChunk("stop")]));
    await collect(streamChat(CONFIG, req({ reasoning_effort: "medium" })));
    expect(ccCreateMock.mock.calls[0][0].reasoning_effort).toBe("medium");
  });

  it("omits reasoning_effort when absent", async () => {
    ccCreateMock.mockResolvedValueOnce(streamOf([finishChunk("stop")]));
    await collect(streamChat(CONFIG, req()));
    expect(ccCreateMock.mock.calls[0][0].reasoning_effort).toBeUndefined();
  });

  it("forwards request.signal into the create() options", async () => {
    ccCreateMock.mockResolvedValueOnce(streamOf([finishChunk("stop")]));
    const ac = new AbortController();
    await collect(streamChat(CONFIG, req({ signal: ac.signal })));
    expect(ccCreateMock.mock.calls[0][1]?.signal).toBe(ac.signal);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// generate_express capture — one-way parse, single POST, no round-trip
// ─────────────────────────────────────────────────────────────────────────────

describe("streamChat — Chat Completions generate_express capture", () => {
  it("interleaved text -> express cue -> text in ONE stream: single create() call, no tools", async () => {
    ccCreateMock.mockResolvedValueOnce(
      streamOf([
        textChunk("Hi "),
        toolCallStart(0, "call_1", "generate_express", ""),
        toolCallArgs(0, GEN_EXPRESS_ARGS),
        finishChunk("tool_calls"), // flushes the buffered call mid-stream; does NOT stop reading
        textChunk("there"),
        finishChunk("stop"),
      ]),
    );

    const events = await collect(streamChat(CONFIG, req()));

    expect(events).toEqual([
      { type: "speech_delta", text: "Hi " },
      {
        type: "express",
        args: { emotion_id: "happy", motion_id: "embarrassed", emotion_text: "[whisper]" },
      },
      { type: "speech_delta", text: "there" },
      { type: "speech_done", text: "Hi there" },
      {
        type: "completed",
        envelope: {
          speech_text: "Hi there",
          emotion: { id: "happy" },
          motion: { id: "embarrassed" },
          emotion_text: "[whisper]",
        },
        responseId: "",
      },
    ]);
    expect(ccCreateMock).toHaveBeenCalledTimes(1);
    expect(ccCreateMock.mock.calls[0][0].tools).toBeUndefined();
  });

  it("recognizes an MCP-namespaced mcp_<server>_generate_express tool name — one call", async () => {
    ccCreateMock.mockResolvedValueOnce(
      streamOf([
        toolCallStart(0, "call_1", "mcp_hermes_generate_express", GEN_EXPRESS_ARGS),
        finishChunk("stop"),
      ]),
    );

    const events = await collect(streamChat(CONFIG, req()));

    expect(events[0]).toEqual({
      type: "express",
      args: { emotion_id: "happy", motion_id: "embarrassed", emotion_text: "[whisper]" },
    });
    expect(ccCreateMock).toHaveBeenCalledTimes(1);
  });

  it("malformed generate_express JSON -> error event, one call, messages untouched", async () => {
    const messages = [{ role: "user", content: "hi" }] as any;
    ccCreateMock.mockResolvedValueOnce(
      streamOf([
        toolCallStart(0, "call_1", "generate_express", "{not valid json"),
        finishChunk("stop"),
      ]),
    );

    const events = await collect(streamChat(CONFIG, req({ messages })));

    expect(events[0].type).toBe("error");
    expect(ccCreateMock).toHaveBeenCalledTimes(1);
    // no assistant/tool result appended — same array, same contents.
    expect(messages).toEqual([{ role: "user", content: "hi" }]);
    expect(ccCreateMock.mock.calls[0][0].messages).toBe(messages);
  });

  it("a non-express tool call yields tool_status done (not express), one call", async () => {
    ccCreateMock.mockResolvedValueOnce(
      streamOf([toolCallStart(0, "call_2", "get_ids", "{}"), finishChunk("stop")]),
    );

    const events = await collect(streamChat(CONFIG, req()));

    expect(events[0]).toEqual({
      type: "tool_status",
      status: { state: "done", tool_id: "get_ids" },
    });
    expect(events.some((e) => e.type === "express")).toBe(false);
    expect(ccCreateMock).toHaveBeenCalledTimes(1);
  });

  it("parallel express + non-express tool_calls in one stream -> one express + one tool_status, one call, no appended messages", async () => {
    const messages = [{ role: "user", content: "hi" }] as any;
    ccCreateMock.mockResolvedValueOnce(
      streamOf([
        toolCallStart(0, "call_a", "generate_express", GEN_EXPRESS_ARGS),
        toolCallStart(1, "call_b", "get_ids", "{}"),
        finishChunk("stop"),
      ]),
    );

    const events = await collect(streamChat(CONFIG, req({ messages })));

    expect(events.filter((e) => e.type === "express")).toHaveLength(1);
    expect(events.filter((e) => e.type === "tool_status")).toHaveLength(1);
    expect(ccCreateMock).toHaveBeenCalledTimes(1);
    expect(messages).toEqual([{ role: "user", content: "hi" }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// usage event
// ─────────────────────────────────────────────────────────────────────────────

describe("streamChat — Chat Completions usage event", () => {
  it("maps the usage chunk (prompt/completion/total_tokens) to a usage event", async () => {
    ccCreateMock.mockResolvedValueOnce(
      streamOf([
        textChunk("hi"),
        finishChunk("stop"),
        usageChunk({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }),
      ]),
    );

    const events = await collect(streamChat(CONFIG, req()));
    expect(events).toContainEqual({
      type: "usage",
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// error handling
// ─────────────────────────────────────────────────────────────────────────────

describe("streamChat — Chat Completions error handling", () => {
  it("create() rejecting (non-abort) -> error event", async () => {
    ccCreateMock.mockRejectedValueOnce(new Error("401 unauthorized"));
    const events = await collect(streamChat(CONFIG, req()));
    expect(events).toEqual([{ type: "error", message: "chat request failed: 401 unauthorized" }]);
  });

  it("create() rejecting with an APIError status -> error event carries status", async () => {
    ccCreateMock.mockRejectedValueOnce(
      Object.assign(new Error("401 Incorrect API key provided"), { status: 401 }),
    );
    const events = await collect(streamChat(CONFIG, req()));
    expect(events).toEqual([
      {
        type: "error",
        message: "chat request failed: 401 Incorrect API key provided",
        status: 401,
      },
    ]);
  });

  it("already-aborted signal -> generator terminates cleanly without calling create()", async () => {
    const ac = new AbortController();
    ac.abort();
    const events = await collect(streamChat(CONFIG, req({ signal: ac.signal })));
    expect(events).toEqual([]);
    expect(ccCreateMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// regression: Responses mode is untouched by the CC branch
// ─────────────────────────────────────────────────────────────────────────────

describe("streamChat — Responses mode regression (chat_api unset/'responses')", () => {
  it("never calls chat.completions.create when chat_api is absent (this mock only stubs chat.completions.create)", async () => {
    const responsesConfig: EndpointsConfig = { ...CONFIG, chat_api: undefined };
    const events = await collect(streamChat(responsesConfig, req({ input: [] })));
    // client.responses is undefined on this mock -> the Responses branch's own
    // try/catch surfaces it as an error event rather than silently falling
    // through to the CC branch (which would have called ccCreateMock instead).
    expect(events).toEqual([
      {
        type: "error",
        message: expect.stringContaining("chat request failed"),
      },
    ]);
    expect(ccCreateMock).not.toHaveBeenCalled();
  });

  it("never calls chat.completions.create when chat_api is explicitly 'responses'", async () => {
    const responsesConfig: EndpointsConfig = { ...CONFIG, chat_api: "responses" };
    await collect(streamChat(responsesConfig, req({ input: [] })));
    expect(ccCreateMock).not.toHaveBeenCalled();
  });
});
