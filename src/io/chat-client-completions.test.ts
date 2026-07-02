/**
 * chat-client-completions.test.ts — streamChat's Chat Completions branch.
 *
 * 검증 대상: config.chat_api === "chat_completions" 일 때 streamChat이
 *   client.chat.completions.create({ stream: true, stream_options: { include_usage: true } })
 * 를 호출하고, `chat.completion.chunk` 스트림을 chat-completions.ts의 createChunkReducer를 통해
 * ChatStreamEvent로 매핑하며, finish_reason "tool_calls"에서 tool 왕복 루프(cap 4)를 도는지.
 *
 * D-CHAT-SDK와 동일 원칙: fetch/SSE를 mock하지 않는다. `openai` 모듈을 mock한다.
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

  it("calls chat.completions.create with messages/tools/stream/stream_options verbatim", async () => {
    ccCreateMock.mockResolvedValueOnce(streamOf([finishChunk("stop")]));
    const tools = [{ type: "function", function: { name: "generate_express" } }] as any;
    const messages = [{ role: "user", content: "hi" }] as any;

    await collect(streamChat(CONFIG, req({ messages, tools })));

    const [body, options] = ccCreateMock.mock.calls[0];
    expect(body.model).toBe("test-model");
    expect(body.messages).toEqual(messages);
    expect(body.tools).toBe(tools);
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(options?.signal).toBeUndefined();
  });

  it("omits tools when request.tools is absent/empty", async () => {
    ccCreateMock.mockResolvedValueOnce(streamOf([finishChunk("stop")]));
    await collect(streamChat(CONFIG, req({ tools: undefined })));
    expect(ccCreateMock.mock.calls[0][0].tools).toBeUndefined();
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
// generate_express capture
// ─────────────────────────────────────────────────────────────────────────────

describe("streamChat — Chat Completions generate_express capture", () => {
  it("a fragmented tool call finalized by finish_reason tool_calls -> express event, then re-request; next round's text turn completes", async () => {
    ccCreateMock
      .mockResolvedValueOnce(
        streamOf([
          toolCallStart(0, "call_1", "generate_express", ""),
          toolCallArgs(0, GEN_EXPRESS_ARGS),
          finishChunk("tool_calls"),
        ]),
      )
      .mockResolvedValueOnce(streamOf([textChunk("Hi there"), finishChunk("stop")]));

    const events = await collect(streamChat(CONFIG, req()));

    expect(events).toEqual([
      {
        type: "express",
        args: { emotion_id: "happy", motion_id: "embarrassed", emotion_text: "[whisper]" },
      },
      { type: "speech_delta", text: "Hi there" },
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
    expect(ccCreateMock).toHaveBeenCalledTimes(2);
  });

  it("appends the assistant tool_calls message + a role:tool 'ok' result before re-requesting", async () => {
    ccCreateMock
      .mockResolvedValueOnce(
        streamOf([
          toolCallStart(0, "call_1", "generate_express", GEN_EXPRESS_ARGS),
          finishChunk("tool_calls"),
        ]),
      )
      .mockResolvedValueOnce(streamOf([finishChunk("stop")]));

    await collect(streamChat(CONFIG, req({ messages: [{ role: "user", content: "hi" }] as any })));

    const secondCallMessages = ccCreateMock.mock.calls[1][0].messages;
    expect(secondCallMessages).toEqual([
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "generate_express", arguments: GEN_EXPRESS_ARGS },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: "ok" },
    ]);
  });

  it("malformed generate_express JSON -> error event, still loops (tool result appended)", async () => {
    ccCreateMock
      .mockResolvedValueOnce(
        streamOf([
          toolCallStart(0, "call_1", "generate_express", "{not valid json"),
          finishChunk("tool_calls"),
        ]),
      )
      .mockResolvedValueOnce(streamOf([finishChunk("stop")]));

    const events = await collect(streamChat(CONFIG, req()));

    expect(events[0].type).toBe("error");
    expect(ccCreateMock).toHaveBeenCalledTimes(2);
    const secondCallMessages = ccCreateMock.mock.calls[1][0].messages;
    expect(secondCallMessages.at(-1)).toEqual({
      role: "tool",
      tool_call_id: "call_1",
      content: "ok",
    });
  });

  it("a non-express tool call yields tool_status done (not express), still loops", async () => {
    ccCreateMock
      .mockResolvedValueOnce(
        streamOf([toolCallStart(0, "call_2", "get_ids", "{}"), finishChunk("tool_calls")]),
      )
      .mockResolvedValueOnce(streamOf([finishChunk("stop")]));

    const events = await collect(streamChat(CONFIG, req()));

    expect(events[0]).toEqual({
      type: "tool_status",
      status: { state: "done", tool_id: "get_ids" },
    });
    expect(events.some((e) => e.type === "express")).toBe(false);
  });

  it("two parallel tool calls in one round both finalize and both get tool results", async () => {
    ccCreateMock
      .mockResolvedValueOnce(
        streamOf([
          toolCallStart(0, "call_a", "generate_express", GEN_EXPRESS_ARGS),
          toolCallStart(1, "call_b", "get_ids", "{}"),
          finishChunk("tool_calls"),
        ]),
      )
      .mockResolvedValueOnce(streamOf([finishChunk("stop")]));

    await collect(streamChat(CONFIG, req()));

    const secondCallMessages = ccCreateMock.mock.calls[1][0].messages;
    const assistantMsg = secondCallMessages.find((m: any) => m.role === "assistant");
    expect(assistantMsg.tool_calls.map((tc: any) => tc.id)).toEqual(["call_a", "call_b"]);
    const toolResults = secondCallMessages.filter((m: any) => m.role === "tool");
    expect(toolResults).toEqual([
      { role: "tool", tool_call_id: "call_a", content: "ok" },
      { role: "tool", tool_call_id: "call_b", content: "ok" },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tool-call loop cap
// ─────────────────────────────────────────────────────────────────────────────

describe("streamChat — Chat Completions tool-call loop cap", () => {
  it("caps the tool round-trip loop at 4 requests and still finalizes", async () => {
    const toolOnlyRound = () =>
      streamOf([
        toolCallStart(0, "call_x", "generate_express", GEN_EXPRESS_ARGS),
        finishChunk("tool_calls"),
      ]);
    ccCreateMock
      .mockResolvedValueOnce(toolOnlyRound())
      .mockResolvedValueOnce(toolOnlyRound())
      .mockResolvedValueOnce(toolOnlyRound())
      .mockResolvedValueOnce(toolOnlyRound());

    const events = await collect(streamChat(CONFIG, req()));

    expect(ccCreateMock).toHaveBeenCalledTimes(4);
    const completedEvent = events.find((e) => e.type === "completed");
    expect(completedEvent).toBeDefined();
    expect(events.find((e) => e.type === "speech_done")).toEqual({ type: "speech_done", text: "" });
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

  it("already-aborted signal -> generator terminates cleanly without calling create()", async () => {
    const ac = new AbortController();
    ac.abort();
    const events = await collect(streamChat(CONFIG, req({ signal: ac.signal })));
    expect(events).toEqual([]);
    expect(ccCreateMock).not.toHaveBeenCalled();
  });
});
