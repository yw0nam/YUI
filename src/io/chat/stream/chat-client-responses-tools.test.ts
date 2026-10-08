/**
 * chat-client-responses-tools.test.ts — streamChat's Responses branch with client-declared tools.
 *
 * A registry (StreamChatOptions.tools) is declared on the Responses request in the flat function
 * shape, a function_call naming a registered tool is executed once however many events carry its
 * arguments, and the results go back in a follow-up request that re-sends the original input items
 * (never chaining on the tool-calling response). Mock the `openai` module, not the wire.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { EndpointsConfig } from "../../../contract";
import { type ChatRequest, type ChatStreamEvent, streamChat } from "./chat-client";
import { type ClientTool, createClientToolRegistry } from "./client-tools";

const createMock = vi.fn();
vi.mock("openai", () => ({
  default: vi.fn(() => ({ responses: { create: createMock } })),
}));

afterEach(() => createMock.mockReset());

async function* streamOf(events: any[]): AsyncGenerator<any> {
  for (const ev of events) yield ev;
}

async function collect(gen: AsyncGenerator<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const out: ChatStreamEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

const CONFIG: EndpointsConfig = {
  chat_base_url: "http://localhost:8643/v1",
  chat_model: "test-model",
  chat_api: "responses",
  stt_base_url: "http://localhost:5517",
  tts_base_url: "http://localhost:8092",
};

const INPUT = [{ role: "user", content: "hi" }];

const req = (over: Partial<ChatRequest> = {}): ChatRequest => ({ input: INPUT, ...over });

// ── event fixtures (Responses stream shapes) ─────────────────────────────────

const ARGS = '{"emotion_id":"happy"}';

const added = (name: string, id: string, index = 0): any => ({
  type: "response.output_item.added",
  output_index: index,
  item: { type: "function_call", id, name, call_id: `call_${id}`, arguments: "" },
});

const argsDone = (name: string, id: string, args = ARGS, index = 0): any => ({
  type: "response.function_call_arguments.done",
  item_id: id,
  output_index: index,
  name,
  arguments: args,
});

const itemDone = (name: string, id: string, args = ARGS, index = 0): any => ({
  type: "response.output_item.done",
  output_index: index,
  item: { type: "function_call", id, name, call_id: `call_${id}`, arguments: args },
});

/** The three events one call arrives on, as a vLLM-style server streams them. */
const call = (name: string, id: string, args = ARGS): any[] => [
  added(name, id),
  argsDone(name, id, args),
  itemDone(name, id, args),
];

const text = (delta: string): any => ({ type: "response.output_text.delta", delta });

const done = (id: string): any => ({
  type: "response.completed",
  response: { id, usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } },
});

// ── registry fixtures ────────────────────────────────────────────────────────

const toolStub = (name: string, execute = vi.fn(async () => "ok")): ClientTool => ({
  name,
  definition: {
    type: "function",
    function: {
      name,
      description: `stub ${name}`,
      parameters: {
        type: "object",
        properties: { emotion_id: { type: "string" } },
        additionalProperties: false,
      },
    },
  },
  execute,
});

const oneWayStub = (name: string): ClientTool => ({ ...toolStub(name), oneWay: true });

const optsFor = (...tools: ClientTool[]) => ({ tools: createClientToolRegistry(tools) });

describe("streamChat — Responses client tool declaration", () => {
  it("declares each registry tool in the flat Responses function shape", async () => {
    createMock.mockResolvedValueOnce(streamOf([done("resp_1")]));

    await collect(streamChat(CONFIG, req(), optsFor(oneWayStub("generate_express"))));

    expect(createMock.mock.calls[0][0].tools).toEqual([
      {
        type: "function",
        name: "generate_express",
        description: "stub generate_express",
        parameters: {
          type: "object",
          properties: { emotion_id: { type: "string" } },
          additionalProperties: false,
        },
        strict: false,
      },
    ]);
  });

  it("carries no tools key without a registry or with an empty one", async () => {
    createMock.mockResolvedValue(streamOf([done("resp_1")]));

    await collect(streamChat(CONFIG, req()));
    await collect(streamChat(CONFIG, req(), optsFor()));

    expect(createMock.mock.calls[0][0]).not.toHaveProperty("tools");
    expect(createMock.mock.calls[1][0]).not.toHaveProperty("tools");
  });
});

describe("streamChat — Responses tool-call round trip", () => {
  it("runs a registered call once across its three events, plays the cue once, and continues into speech", async () => {
    const gen = oneWayStub("generate_express");
    createMock
      .mockResolvedValueOnce(streamOf([...call("generate_express", "fc_1"), done("resp_1")]))
      .mockResolvedValueOnce(streamOf([text("Hello"), done("resp_2")]));

    const events = await collect(streamChat(CONFIG, req(), optsFor(gen)));

    expect(gen.execute).toHaveBeenCalledOnce();
    expect(gen.execute).toHaveBeenCalledWith({ emotion_id: "happy" });
    expect(events.filter((e) => e.type === "express")).toEqual([
      { type: "express", args: { emotion_id: "happy" } },
    ]);
    expect(events.filter((e) => e.type === "keepalive")).toHaveLength(1);
    expect(events.at(-1)).toEqual({
      type: "completed",
      envelope: { speech_text: "Hello", emotion: { id: "happy" } },
      responseId: "resp_2",
    });
    expect(events.filter((e) => e.type === "usage")).toHaveLength(2);
  });

  it("re-sends the original input and the call + output under the turn's original previous_response_id", async () => {
    createMock
      .mockResolvedValueOnce(streamOf([...call("generate_express", "fc_1"), done("resp_tool")]))
      .mockResolvedValueOnce(streamOf([text("Hi"), done("resp_2")]));

    await collect(
      streamChat(
        CONFIG,
        req({ previous_response_id: "resp_0" }),
        optsFor(oneWayStub("generate_express")),
      ),
    );

    const [first, second] = createMock.mock.calls.map(([body]) => body);
    expect(first.previous_response_id).toBe("resp_0");
    expect(second.previous_response_id).toBe("resp_0");
    expect(second.input).toEqual([
      ...INPUT,
      { type: "function_call", call_id: "call_fc_1", name: "generate_express", arguments: ARGS },
      { type: "function_call_output", call_id: "call_fc_1", output: "ok" },
    ]);
    expect(second.tools).toEqual(first.tools);
    expect(INPUT).toHaveLength(1);
  });

  it("normalises a string input into one user message item for the follow-up", async () => {
    createMock
      .mockResolvedValueOnce(streamOf([...call("generate_express", "fc_1"), done("resp_1")]))
      .mockResolvedValueOnce(streamOf([text("Hi"), done("resp_2")]));

    await collect(
      streamChat(CONFIG, req({ input: "hello" }), optsFor(oneWayStub("generate_express"))),
    );

    expect(createMock.mock.calls[1][0].input[0]).toEqual({ role: "user", content: "hello" });
  });

  it("a cue-only call in a response that already spoke is a finished turn — no round trip", async () => {
    const gen = oneWayStub("generate_express");
    createMock.mockResolvedValueOnce(
      streamOf([text("Hi "), ...call("generate_express", "fc_1"), text("there"), done("resp_1")]),
    );

    const events = await collect(streamChat(CONFIG, req(), optsFor(gen)));

    expect(createMock).toHaveBeenCalledOnce();
    expect(events.some((e) => e.type === "express")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "completed", responseId: "resp_1" });
  });

  it("a tool that answers a question is answered back even when the response spoke first", async () => {
    const lookup = toolStub(
      "lookup",
      vi.fn(async () => "42"),
    );
    createMock
      .mockResolvedValueOnce(
        streamOf([text("Let me see. "), ...call("lookup", "fc_1"), done("resp_1")]),
      )
      .mockResolvedValueOnce(streamOf([text("It is 42."), done("resp_2")]));

    const events = await collect(streamChat(CONFIG, req(), optsFor(lookup)));

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(createMock.mock.calls[1][0].input.at(-1)).toEqual({
      type: "function_call_output",
      call_id: "call_fc_1",
      output: "42",
    });
    expect(events.filter((e) => e.type === "tool_status")).toEqual([
      { type: "tool_status", status: { state: "running", tool_id: "lookup" } },
      { type: "tool_status", status: { state: "done", tool_id: "lookup" } },
    ]);
  });

  it("a failing execute is returned to the model as an error result", async () => {
    const broken = toolStub(
      "lookup",
      vi.fn(async () => Promise.reject(new Error("boom"))),
    );
    createMock
      .mockResolvedValueOnce(streamOf([...call("lookup", "fc_1"), done("resp_1")]))
      .mockResolvedValueOnce(streamOf([text("Sorry."), done("resp_2")]));

    await collect(streamChat(CONFIG, req(), optsFor(broken)));

    expect(createMock.mock.calls[1][0].input.at(-1)).toMatchObject({ output: "error: boom" });
  });

  it("an MCP-namespaced express call the client did not register plays its cue and is never answered", async () => {
    createMock.mockResolvedValueOnce(
      streamOf([...call("mcp_yui_generate_express", "fc_1"), done("resp_1")]),
    );

    const events = await collect(
      streamChat(CONFIG, req(), optsFor(oneWayStub("generate_express"))),
    );

    expect(createMock).toHaveBeenCalledOnce();
    expect(events.filter((e) => e.type === "express")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: "completed", responseId: "resp_1" });
  });

  it("an unregistered non-express call stays a chip and is never answered", async () => {
    createMock.mockResolvedValueOnce(streamOf([...call("web_search", "fc_1"), done("resp_1")]));

    const events = await collect(
      streamChat(CONFIG, req(), optsFor(oneWayStub("generate_express"))),
    );

    expect(createMock).toHaveBeenCalledOnce();
    expect(events.filter((e) => e.type === "tool_status")).toEqual([
      { type: "tool_status", status: { state: "running", tool_id: "web_search" } },
      { type: "tool_status", status: { state: "done", tool_id: "web_search" } },
    ]);
  });

  it("stops returning results after three round trips", async () => {
    const gen = oneWayStub("generate_express");
    createMock.mockImplementation(async () =>
      streamOf([...call("generate_express", `fc_${createMock.mock.calls.length}`), done("resp_n")]),
    );

    const events = await collect(streamChat(CONFIG, req(), optsFor(gen)));

    expect(createMock).toHaveBeenCalledTimes(4);
    expect(events.at(-1)).toMatchObject({ type: "completed" });
  });

  it("does not answer a response that failed", async () => {
    createMock.mockResolvedValueOnce(
      streamOf([
        ...call("generate_express", "fc_1"),
        { type: "response.failed", response: { error: { message: "bad" } } },
      ]),
    );

    const events = await collect(
      streamChat(CONFIG, req(), optsFor(oneWayStub("generate_express"))),
    );

    expect(createMock).toHaveBeenCalledOnce();
    expect(events.at(-1)).toEqual({ type: "error", message: "bad" });
  });
});
