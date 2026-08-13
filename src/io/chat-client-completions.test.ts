/**
 * chat-client-completions.test.ts — streamChat's Chat Completions branch.
 *
 * Verifies that when config.chat_api === "chat_completions", streamChat calls
 *   client.chat.completions.create({ stream: true, stream_options: { include_usage: true } })
 * and maps the `chat.completion.chunk` stream to ChatStreamEvent via chat-completions.ts's
 * createChunkReducer. A registry (StreamChatOptions.tools) declares the client's tools on the
 * request, executes the calls that name one, and returns the results in a bounded round trip;
 * a call naming an unregistered tool stays one-way. Without a registry the turn is a single
 * request carrying no tools.
 *
 * Same principle as D-CHAT-SDK: do not mock fetch/SSE. Mock the `openai` module.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { EndpointsConfig } from "../contract";
import { type ChatRequest, type ChatStreamEvent, streamChat } from "./chat-client";
import { type ClientTool, createClientToolRegistry } from "./client-tools";

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

// ── client tool registry fixtures ────────────────────────────────────────────

const toolStub = (name: string, result: string | (() => Promise<string>) = "ok"): ClientTool => ({
  name,
  definition: {
    type: "function",
    function: {
      name,
      description: `stub ${name}`,
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  execute: vi.fn(typeof result === "function" ? result : async () => result),
});

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

  it("calls chat.completions.create with messages/stream/stream_options verbatim; no registry means no tools field", async () => {
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
// generate_express capture with no registry — one-way parse, single POST
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
// client tool registry — declaration, execution, round trip
// ─────────────────────────────────────────────────────────────────────────────

describe("streamChat — Chat Completions client tool declaration", () => {
  it("sends the registry's definitions as tools[] on the request", async () => {
    ccCreateMock.mockResolvedValueOnce(streamOf([textChunk("hi"), finishChunk("stop")]));
    const registry = createClientToolRegistry([toolStub("generate_express")]);

    await collect(streamChat(CONFIG, req(), { tools: registry }));

    expect(ccCreateMock.mock.calls[0][0].tools).toEqual(registry.definitions());
  });

  it("an empty registry declares no tools field", async () => {
    ccCreateMock.mockResolvedValueOnce(streamOf([finishChunk("stop")]));
    await collect(streamChat(CONFIG, req(), { tools: createClientToolRegistry([]) }));
    expect(ccCreateMock.mock.calls[0][0].tools).toBeUndefined();
  });

  it("a response with no tool call stays a single request with today's events", async () => {
    ccCreateMock.mockResolvedValueOnce(
      streamOf([textChunk("Hello"), textChunk(" world"), finishChunk("stop")]),
    );
    const registry = createClientToolRegistry([toolStub("generate_express")]);

    const events = await collect(streamChat(CONFIG, req(), { tools: registry }));

    expect(events).toEqual([
      { type: "speech_delta", text: "Hello" },
      { type: "speech_delta", text: " world" },
      { type: "speech_done", text: "Hello world" },
      { type: "completed", envelope: { speech_text: "Hello world" }, responseId: "" },
    ]);
    expect(ccCreateMock).toHaveBeenCalledTimes(1);
  });
});

describe("streamChat — Chat Completions tool-call round trip", () => {
  it("executes the registered tool with parsed args, emits the cue, and re-requests into speech", async () => {
    const express = toolStub("generate_express");
    const registry = createClientToolRegistry([express]);
    ccCreateMock
      .mockResolvedValueOnce(
        streamOf([
          toolCallStart(0, "call_1", "generate_express", GEN_EXPRESS_ARGS),
          finishChunk("tool_calls"),
        ]),
      )
      .mockResolvedValueOnce(streamOf([textChunk("Hi there"), finishChunk("stop")]));

    const events = await collect(streamChat(CONFIG, req(), { tools: registry }));

    expect(express.execute).toHaveBeenCalledWith({
      emotion_id: "happy",
      motion_id: "embarrassed",
      emotion_text: "[whisper]",
    });
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

  it("appends the assistant tool_calls message and one tool result per call, leaving the caller's array untouched", async () => {
    const messages = [{ role: "user", content: "hi" }] as any;
    const registry = createClientToolRegistry([toolStub("generate_express")]);
    ccCreateMock
      .mockResolvedValueOnce(
        streamOf([
          toolCallStart(0, "call_1", "generate_express", GEN_EXPRESS_ARGS),
          finishChunk("tool_calls"),
        ]),
      )
      .mockResolvedValueOnce(streamOf([textChunk("ok"), finishChunk("stop")]));

    await collect(streamChat(CONFIG, req({ messages }), { tools: registry }));

    const second = ccCreateMock.mock.calls[1][0];
    expect(second.messages).toEqual([
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
    expect(second.tools).toEqual(registry.definitions());
    expect(messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("caps the turn at three round trips and surfaces the text collected so far", async () => {
    const registry = createClientToolRegistry([toolStub("generate_express")]);
    for (let i = 0; i < 6; i++) {
      ccCreateMock.mockResolvedValueOnce(
        streamOf([
          textChunk(`t${i}`),
          toolCallStart(0, `call_${i}`, "generate_express", GEN_EXPRESS_ARGS),
          finishChunk("tool_calls"),
        ]),
      );
    }

    const events = await collect(streamChat(CONFIG, req(), { tools: registry }));

    expect(ccCreateMock).toHaveBeenCalledTimes(4);
    expect(events.at(-1)).toEqual({
      type: "completed",
      envelope: {
        speech_text: "t0t1t2t3",
        emotion: { id: "happy" },
        motion: { id: "embarrassed" },
        emotion_text: "[whisper]",
      },
      responseId: "",
    });
  });

  it("runs a second registered tool through the same engine — status, result, round trip", async () => {
    const weather = toolStub("get_weather", "22C");
    const registry = createClientToolRegistry([toolStub("generate_express"), weather]);
    ccCreateMock
      .mockResolvedValueOnce(
        streamOf([
          toolCallStart(0, "call_w", "get_weather", '{"city":"seoul"}'),
          finishChunk("tool_calls"),
        ]),
      )
      .mockResolvedValueOnce(streamOf([textChunk("warm"), finishChunk("stop")]));

    const events = await collect(streamChat(CONFIG, req(), { tools: registry }));

    expect(weather.execute).toHaveBeenCalledWith({ city: "seoul" });
    expect(events[0]).toEqual({
      type: "tool_status",
      status: { state: "done", tool_id: "get_weather" },
    });
    expect(ccCreateMock.mock.calls[1][0].messages.at(-1)).toEqual({
      role: "tool",
      tool_call_id: "call_w",
      content: "22C",
    });
    expect(events.some((e) => e.type === "speech_delta" && e.text === "warm")).toBe(true);
  });

  it("a call naming an unregistered tool stays one-way — cue plays, no result, single request", async () => {
    const registry = createClientToolRegistry([toolStub("generate_express")]);
    ccCreateMock.mockResolvedValueOnce(
      streamOf([
        toolCallStart(0, "call_1", "mcp_hermes_generate_express", GEN_EXPRESS_ARGS),
        finishChunk("stop"),
      ]),
    );

    const events = await collect(streamChat(CONFIG, req(), { tools: registry }));

    expect(events[0].type).toBe("express");
    expect(ccCreateMock).toHaveBeenCalledTimes(1);
  });

  it("a failing execute returns its error as the tool result and still round-trips", async () => {
    const boom = toolStub("get_weather", async () => {
      throw new Error("network down");
    });
    const registry = createClientToolRegistry([boom]);
    ccCreateMock
      .mockResolvedValueOnce(
        streamOf([toolCallStart(0, "call_w", "get_weather", "{}"), finishChunk("tool_calls")]),
      )
      .mockResolvedValueOnce(streamOf([textChunk("hm"), finishChunk("stop")]));

    await collect(streamChat(CONFIG, req(), { tools: registry }));

    expect(ccCreateMock).toHaveBeenCalledTimes(2);
    expect(ccCreateMock.mock.calls[1][0].messages.at(-1)).toEqual({
      role: "tool",
      tool_call_id: "call_w",
      content: expect.stringContaining("network down"),
    });
  });

  it("unparseable arguments surface an error event, skip execution, and end the turn", async () => {
    const express = toolStub("generate_express");
    const registry = createClientToolRegistry([express]);
    ccCreateMock.mockResolvedValueOnce(
      streamOf([
        toolCallStart(0, "call_1", "generate_express", "{not valid json"),
        finishChunk("tool_calls"),
      ]),
    );

    const events = await collect(streamChat(CONFIG, req(), { tools: registry }));

    expect(events[0].type).toBe("error");
    expect(express.execute).not.toHaveBeenCalled();
    expect(ccCreateMock).toHaveBeenCalledTimes(1);
  });

  it("gives an id-less tool call a synthesized tool_call_id shared by both messages", async () => {
    const registry = createClientToolRegistry([toolStub("generate_express")]);
    ccCreateMock
      .mockResolvedValueOnce(
        streamOf([
          {
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    { function: { name: "generate_express", arguments: GEN_EXPRESS_ARGS } },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
          finishChunk("tool_calls"),
        ]),
      )
      .mockResolvedValueOnce(streamOf([textChunk("ok"), finishChunk("stop")]));

    await collect(streamChat(CONFIG, req(), { tools: registry }));

    const appended = ccCreateMock.mock.calls[1][0].messages.slice(-2);
    expect(appended[0].tool_calls[0].id).toBe(appended[1].tool_call_id);
    expect(appended[1].tool_call_id).toBeTruthy();
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
