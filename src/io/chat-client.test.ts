/**
 * chat-client.test.ts — openai-SDK adapter (TDD red, #13).
 *
 * 검증 대상: streamChat(config, request)가 공식 `openai` SDK의
 *   client.responses.create({ stream: true }) → async-iterable of TYPED Responses events
 * 를 우리 ChatStreamEvent / ControlEnvelope로 매핑하는지.
 *
 * 결정 D-CHAT-SDK(docs/prd.md): SSE framing/chunk-split/abort는 SDK 소유.
 * → 절대 fetch/ReadableStream/raw-bytes를 mock하지 않는다. `openai` 모듈을 mock한다.
 *
 * 이벤트 shape 원천: openai@6.42 d.ts + docs/openai_response_sdk/sse-event-format.md.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { EndpointsConfig } from "../contract";
import {
  streamChat,
  selectChatBaseUrl,
  type ChatStreamEvent,
  type ChatRequest,
} from "./chat-client";

// ── openai SDK mock ──────────────────────────────────────────────────────────
// new OpenAI(opts) → { responses: { create: createMock } }.
const createMock = vi.fn();
vi.mock("openai", () => ({
  default: vi.fn(() => ({ responses: { create: createMock } })),
}));

afterEach(() => vi.clearAllMocks());

// ── helpers ──────────────────────────────────────────────────────────────────

/** typed SDK 이벤트 배열 → async-iterable (responses.create stream 결과 모사). */
async function* streamOf(events: any[]): AsyncGenerator<any> {
  for (const ev of events) yield ev;
}

/** 제너레이터를 끝까지 소진해 yield된 ChatStreamEvent를 모은다. */
async function collect(gen: AsyncGenerator<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const out: ChatStreamEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

const CONFIG: EndpointsConfig = {
  chat_base_url: "http://localhost:8642",
  chat_endpoint: "/v1/responses",
  stt_base_url: "http://localhost:5517",
  tts_base_url: "http://localhost:8092",
};

const req = (over: Partial<ChatRequest> = {}): ChatRequest => ({
  input: [{ role: "user", content: "hi" }],
  ...over,
});

// 이벤트 빌더(verified shapes) ──────────────────────────────────────────────────
const textDelta = (delta: string): any => ({
  type: "response.output_text.delta",
  delta,
  item_id: "msg_1",
  output_index: 0,
  content_index: 0,
  sequence_number: 0,
});

const textDone = (text: string): any => ({
  type: "response.output_text.done",
  text,
  item_id: "msg_1",
  output_index: 0,
  content_index: 0,
});

const fnAdded = (name: string, id: string, output_index: number): any => ({
  type: "response.output_item.added",
  output_index,
  item: { type: "function_call", id, name, call_id: `call_${id}`, arguments: "", status: "in_progress" },
  sequence_number: 0,
});

/**
 * Live Hermes shape: function_call args arrive fully-formed INSIDE output_item.added/done
 * (item.arguments), with NO function_call_arguments.* events. MCP-registered tools surface
 * here under their namespaced name (mcp_<server>_<tool>).
 */
const fnAddedWithArgs = (name: string, id: string, output_index: number, args: string): any => ({
  type: "response.output_item.added",
  output_index,
  item: { type: "function_call", id, name, call_id: `call_${id}`, arguments: args, status: "in_progress" },
  sequence_number: 0,
});

const fnArgsDone = (name: string, item_id: string, output_index: number, args: string): any => ({
  type: "response.function_call_arguments.done",
  item_id,
  output_index,
  name, // ← name IS present here; express는 여기서 식별된다
  arguments: args,
});

const fnItemDone = (name: string, id: string, output_index: number, args: string): any => ({
  type: "response.output_item.done",
  output_index,
  item: { type: "function_call", id, name, arguments: args, status: "completed" },
});

/** response.completed — output[]엔 message item만, function_call은 빠진다. */
const completed = (text: string): any => ({
  type: "response.completed",
  response: {
    id: "resp_1",
    status: "completed",
    output: [
      {
        type: "message",
        id: "msg_1",
        role: "assistant",
        content: [{ type: "output_text", text }],
      },
    ],
    metadata: { thread_id: "th_1" },
  },
});

/** response.completed carrying a final usage block (token accounting at end-of-turn). */
const completedWithUsage = (
  text: string,
  usage: Record<string, unknown>,
): any => {
  const ev = completed(text);
  ev.response.usage = usage;
  return ev;
};

/** generate_express FLAT args (contract.md §1/§3): emotion_id / motion_id / emotion_text. */
const GEN_EXPRESS_FLAT =
  '{"emotion_id":"happy","motion_id":"embarrassed","emotion_text":"[whisper in small voice]"}';

/** Live Hermes MCP-namespaced tool name for generate_express (verified against backend). */
const MCP_GEN_EXPRESS = "mcp_tts_express_server_generate_express";
/** A sibling MCP tool that is NOT express — must remain a generic tool_status. */
const MCP_GET_IDS = "mcp_tts_express_server_get_ids";
/** Live flat args as the backend actually sends them. */
const LIVE_EXPRESS_FLAT =
  '{"emotion_id":"happy","motion_id":"happy","emotion_text":"[cheerful warm tone]"}';

// ── tests ──────────────────────────────────────────────────────────────────────

describe("streamChat — text streaming", () => {
  it("maps output_text deltas → speech_delta in order, .done → speech_done, completed → envelope.speech_text", async () => {
    createMock.mockResolvedValue(
      streamOf([
        textDelta("안녕"),
        textDelta("하세요"),
        textDone("안녕하세요"),
        completed("안녕하세요"),
      ]),
    );

    const events = await collect(streamChat(CONFIG, req()));

    const deltas = events.filter((e) => e.type === "speech_delta");
    expect(deltas).toEqual([
      { type: "speech_delta", text: "안녕" },
      { type: "speech_delta", text: "하세요" },
    ]);

    const done = events.find((e) => e.type === "speech_done");
    expect(done).toEqual({ type: "speech_done", text: "안녕하세요" });

    const final = events.find((e) => e.type === "completed");
    expect(final).toBeDefined();
    expect(final!.type === "completed" && final!.envelope.speech_text).toBe("안녕하세요");
  });
});

describe("streamChat — generate_express capture (flat args)", () => {
  it("output_item.added(generate_express) + function_call_arguments.done → express event with FLAT args", async () => {
    createMock.mockResolvedValue(
      streamOf([
        fnAdded("generate_express", "fc_1", 0),
        fnArgsDone("generate_express", "fc_1", 0, GEN_EXPRESS_FLAT),
        completed(""),
      ]),
    );

    const events = await collect(streamChat(CONFIG, req()));

    const express = events.find((e) => e.type === "express");
    expect(express).toBeDefined();
    if (express!.type !== "express") throw new Error("narrow");
    // FLAT shape — no nested emotion/motion objects, no should_speak.
    expect(express.args.emotion_id).toBe("happy");
    expect(express.args.motion_id).toBe("embarrassed");
    expect(express.args.emotion_text).toBe("[whisper in small voice]");
    expect((express.args as Record<string, unknown>).should_speak).toBeUndefined();
  });

  it("normalizes flat args into the completed envelope: emotion_id→emotion{id}, motion_id→motion{id}, emotion_text", async () => {
    createMock.mockResolvedValue(
      streamOf([
        textDelta("안녕"),
        fnAdded("generate_express", "fc_1", 1),
        fnArgsDone("generate_express", "fc_1", 1, GEN_EXPRESS_FLAT),
        textDone("안녕"),
        completed("안녕"),
      ]),
    );

    const events = await collect(streamChat(CONFIG, req()));
    const final = events.find((e) => e.type === "completed");
    expect(final).toBeDefined();
    if (final!.type !== "completed") throw new Error("narrow");
    const env = final.envelope;
    // 텍스트와 generate_express가 하나의 정규화된 envelope으로 합쳐진다.
    expect(env.speech_text).toBe("안녕");
    // Normalized to the unchanged downstream renderer seam (EmotionSignal / MotionSignal).
    expect(env.emotion).toEqual({ id: "happy" });
    expect(env.motion).toEqual({ id: "embarrassed" });
    expect(env.emotion_text).toBe("[whisper in small voice]");
    // should_speak is gone (D-NO-SPEAK-GATE).
    expect((env as Record<string, unknown>).should_speak).toBeUndefined();
  });

  it("partial flat args normalize only the present fields (emotion_id only)", async () => {
    createMock.mockResolvedValue(
      streamOf([
        fnAdded("generate_express", "fc_1", 0),
        fnArgsDone("generate_express", "fc_1", 0, '{"emotion_id":"thinking"}'),
        completed(""),
      ]),
    );

    const events = await collect(streamChat(CONFIG, req()));
    const final = events.find((e) => e.type === "completed");
    if (final!.type !== "completed") throw new Error("narrow");
    const env = final.envelope;
    expect(env.emotion).toEqual({ id: "thinking" });
    expect(env.motion).toBeUndefined();
    expect(env.emotion_text).toBeUndefined();
  });

  it("captures generate_express mid-stream even though it is ABSENT from response.completed.output[]", async () => {
    const stream = [
      textDelta("hi"),
      fnAdded("generate_express", "fc_1", 1),
      fnArgsDone("generate_express", "fc_1", 1, GEN_EXPRESS_FLAT),
      textDone("hi"),
      completed("hi"),
    ];
    // sanity: 최종 payload에 function_call이 정말 없음을 잠근다.
    const compl = stream.find((e) => e.type === "response.completed") as any;
    expect(compl.response.output.some((o: any) => o.type === "function_call")).toBe(false);

    createMock.mockResolvedValue(streamOf(stream));
    const events = await collect(streamChat(CONFIG, req()));

    expect(events.some((e) => e.type === "express")).toBe(true);
  });
});

describe("streamChat — native tool → tool_status", () => {
  it("web_search function_call added(in_progress) → tool_status running, done(completed) → tool_status done; never an express event", async () => {
    createMock.mockResolvedValue(
      streamOf([
        fnAdded("web_search", "fc_1", 0),
        fnItemDone("web_search", "fc_1", 0, "{}"),
        completed(""),
      ]),
    );

    const events = await collect(streamChat(CONFIG, req()));
    const statuses = events.filter((e) => e.type === "tool_status");
    expect(statuses.length).toBe(2);

    if (statuses[0].type !== "tool_status" || statuses[1].type !== "tool_status")
      throw new Error("narrow");
    expect(statuses[0].status.state).toBe("running");
    expect(statuses[0].status.tool_id).toBe("web_search");
    expect(statuses[1].status.state).toBe("done");
    expect(statuses[1].status.tool_id).toBe("web_search");

    // web_search는 express로 새지 않는다.
    expect(events.some((e) => e.type === "express")).toBe(false);
  });

  it("generate_express function_call is NOT emitted as a tool_status", async () => {
    createMock.mockResolvedValue(
      streamOf([
        fnAdded("generate_express", "fc_1", 0),
        fnArgsDone("generate_express", "fc_1", 0, GEN_EXPRESS_FLAT),
        completed(""),
      ]),
    );

    const events = await collect(streamChat(CONFIG, req()));
    expect(events.some((e) => e.type === "tool_status")).toBe(false);
    expect(events.some((e) => e.type === "express")).toBe(true);
  });
});

describe("streamChat — generate_express-absent turn", () => {
  it("text-only stream → completed envelope has speech_text set, emotion/motion/emotion_text undefined (no invented defaults)", async () => {
    createMock.mockResolvedValue(
      streamOf([textDelta("그냥 텍스트"), textDone("그냥 텍스트"), completed("그냥 텍스트")]),
    );

    const events = await collect(streamChat(CONFIG, req()));
    const final = events.find((e) => e.type === "completed");
    expect(final).toBeDefined();
    if (final!.type !== "completed") throw new Error("narrow");
    const env = final.envelope;
    expect(env.speech_text).toBe("그냥 텍스트");
    // 파서는 idle/직전 기본값을 발명하지 않는다 — 그건 consumer의 몫.
    expect(env.emotion).toBeUndefined();
    expect(env.motion).toBeUndefined();
    expect(env.emotion_text).toBeUndefined();
    // should_speak 자체가 사라졌다 (D-NO-SPEAK-GATE).
    expect((env as Record<string, unknown>).should_speak).toBeUndefined();
  });
});

// ── LIVE Hermes backend shape (#63) ────────────────────────────────────────────
// Verified stream: express tool is MCP-namespaced and its args ride inside
// output_item.added/done (item.arguments); NO function_call_arguments.* events.
describe("streamChat — live MCP-namespaced generate_express (#63)", () => {
  it("recognizes mcp_…_generate_express + args from output_item.done → express event (no function_call_arguments.*)", async () => {
    createMock.mockResolvedValue(
      streamOf([
        textDelta("hi"),
        fnAddedWithArgs(MCP_GEN_EXPRESS, "fc_1", 1, LIVE_EXPRESS_FLAT),
        fnItemDone(MCP_GEN_EXPRESS, "fc_1", 1, LIVE_EXPRESS_FLAT),
        textDone("hi"),
        completed("hi"),
      ]),
    );

    const events = await collect(streamChat(CONFIG, req()));

    const express = events.find((e) => e.type === "express");
    expect(express).toBeDefined();
    if (express!.type !== "express") throw new Error("narrow");
    expect(express.args.emotion_id).toBe("happy");
    expect(express.args.motion_id).toBe("happy");
    expect(express.args.emotion_text).toBe("[cheerful warm tone]");

    // MCP-namespaced express must NOT leak as a tool_status chip.
    expect(events.some((e) => e.type === "tool_status")).toBe(false);
  });

  it("normalizes live express into the completed envelope (emotion/motion/emotion_text)", async () => {
    createMock.mockResolvedValue(
      streamOf([
        fnAddedWithArgs(MCP_GEN_EXPRESS, "fc_1", 0, LIVE_EXPRESS_FLAT),
        fnItemDone(MCP_GEN_EXPRESS, "fc_1", 0, LIVE_EXPRESS_FLAT),
        completed(""),
      ]),
    );

    const events = await collect(streamChat(CONFIG, req()));
    const final = events.find((e) => e.type === "completed");
    expect(final).toBeDefined();
    if (final!.type !== "completed") throw new Error("narrow");
    const env = final.envelope;
    expect(env.emotion).toEqual({ id: "happy" });
    expect(env.motion).toEqual({ id: "happy" });
    expect(env.emotion_text).toBe("[cheerful warm tone]");
  });

  it("a sibling MCP tool (…_get_ids) stays a tool_status running→done and never an express event", async () => {
    createMock.mockResolvedValue(
      streamOf([
        fnAdded(MCP_GET_IDS, "fc_2", 0),
        fnItemDone(MCP_GET_IDS, "fc_2", 0, "{}"),
        completed(""),
      ]),
    );

    const events = await collect(streamChat(CONFIG, req()));
    const statuses = events.filter((e) => e.type === "tool_status");
    expect(statuses.length).toBe(2);
    if (statuses[0].type !== "tool_status" || statuses[1].type !== "tool_status")
      throw new Error("narrow");
    expect(statuses[0].status).toEqual({ state: "running", tool_id: MCP_GET_IDS });
    expect(statuses[1].status).toEqual({ state: "done", tool_id: MCP_GET_IDS });

    // …_get_ids is a real tool, not express.
    expect(events.some((e) => e.type === "express")).toBe(false);
  });

  it("end-to-end live turn: express (mcp) + get_ids (mcp) coexist — express captured, get_ids stays tool_status", async () => {
    createMock.mockResolvedValue(
      streamOf([
        fnAdded(MCP_GET_IDS, "fc_1", 0),
        fnItemDone(MCP_GET_IDS, "fc_1", 0, "{}"),
        fnAddedWithArgs(MCP_GEN_EXPRESS, "fc_2", 1, LIVE_EXPRESS_FLAT),
        fnItemDone(MCP_GEN_EXPRESS, "fc_2", 1, LIVE_EXPRESS_FLAT),
        textDelta("hi"),
        textDone("hi"),
        completed("hi"),
      ]),
    );

    const events = await collect(streamChat(CONFIG, req()));
    const final = events.find((e) => e.type === "completed");
    if (final!.type !== "completed") throw new Error("narrow");
    const env = final.envelope;

    expect(env.emotion).toEqual({ id: "happy" });
    expect(env.motion).toEqual({ id: "happy" });
    expect(env.emotion_text).toBe("[cheerful warm tone]");
    expect(env.speech_text).toBe("hi");
    // get_ids drove tool_status; the express tool did not.
    expect(env.tool_status).toEqual({ state: "done", tool_id: MCP_GET_IDS });
  });

  it("does not emit a duplicate express when args arrive in BOTH added and done", async () => {
    createMock.mockResolvedValue(
      streamOf([
        fnAddedWithArgs(MCP_GEN_EXPRESS, "fc_1", 0, LIVE_EXPRESS_FLAT),
        fnItemDone(MCP_GEN_EXPRESS, "fc_1", 0, LIVE_EXPRESS_FLAT),
        completed(""),
      ]),
    );

    const events = await collect(streamChat(CONFIG, req()));
    expect(events.filter((e) => e.type === "express").length).toBe(1);
  });
});

describe("streamChat — error handling", () => {
  it("error event → error ChatStreamEvent with message", async () => {
    createMock.mockResolvedValue(
      streamOf([
        textDelta("부분"),
        { type: "error", code: "execution_error", message: "Unexpected error occurred." },
      ]),
    );

    const events = await collect(streamChat(CONFIG, req()));
    const err = events.find((e) => e.type === "error");
    expect(err).toEqual({ type: "error", message: "Unexpected error occurred." });
  });

  it("malformed generate_express arguments → error event; generator does NOT throw and runs to completion", async () => {
    // NOTE for implementer: generate_express arguments가 깨진 JSON일 때 — error를 emit한다고 가정.
    // (대안: 조용히 skip. 확정 시 이 테스트를 갱신할 것.) 핵심 보장: 제너레이터가 throw하지 않고
    // completed까지 정상 진행한다.
    createMock.mockResolvedValue(
      streamOf([
        fnAdded("generate_express", "fc_1", 0),
        fnArgsDone("generate_express", "fc_1", 0, "{not json"),
        textDone("hi"),
        completed("hi"),
      ]),
    );

    // collect() rejecting would fail the test here — so awaiting it directly is a
    // STRONGER "does not throw" guarantee than expect(asyncFn).not.toThrow(), which
    // resolves synchronously without awaiting the inner promise (vitest 4).
    const events = await collect(streamChat(CONFIG, req()));

    expect(events.some((e) => e.type === "error")).toBe(true);
    // 깨진 express에도 불구하고 스트림은 끝까지 진행해 completed를 낸다.
    expect(events.some((e) => e.type === "completed")).toBe(true);
  });
});

describe("streamChat — abort", () => {
  it("already-aborted signal → generator terminates cleanly (no hang)", async () => {
    const ac = new AbortController();
    ac.abort();
    // SDK가 aborted signal에 던질 수도 있으므로 reject로 모사.
    createMock.mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));

    // NOTE for implementer: 이미 abort된 signal에서 streamChat은 hang 없이 종료해야 한다
    // (조용히 종료하거나 error 1회 emit). 둘 다 허용 — 핵심은 제너레이터가 끝난다는 것.
    let events: ChatStreamEvent[] = [];
    await expect(async () => {
      events = await collect(streamChat(CONFIG, req({ signal: ac.signal })));
    }).not.toThrow();

    // error를 냈다면 한 번만, 아니면 0개. 어느 쪽이든 깨끗이 종료한다.
    expect(events.filter((e) => e.type !== "error").length).toBe(0);
  });

  it("forwards request.signal into the SDK create() options", async () => {
    // NOTE for implementer: signal wiring shape이 확정되면 강화할 것 —
    // 현재는 create() 옵션 객체에 동일한 AbortSignal이 전달되는지만 soft하게 본다.
    const ac = new AbortController();
    createMock.mockResolvedValue(streamOf([completed("")]));

    await collect(streamChat(CONFIG, req({ signal: ac.signal })));

    expect(createMock).toHaveBeenCalledTimes(1);
    const opts = createMock.mock.calls[0]?.[1] ?? createMock.mock.calls[0]?.[0];
    expect(opts).toBeDefined();
    expect((opts as any).signal).toBe(ac.signal);
  });
});

describe("streamChat — SDK request wiring", () => {
  it("calls responses.create with stream:true and forwards input + previous_response_id", async () => {
    createMock.mockResolvedValue(streamOf([completed("")]));

    const request = req({
      input: [{ role: "user", content: "안녕" }],
      previous_response_id: "resp_prev",
    });
    await collect(streamChat(CONFIG, request));

    expect(createMock).toHaveBeenCalledTimes(1);
    const body = createMock.mock.calls[0]?.[0];
    expect(body).toMatchObject({
      stream: true,
      input: request.input,
      previous_response_id: "resp_prev",
    });
  });

  it("forwards config.chat_instructions as the Responses `instructions` field", async () => {
    createMock.mockResolvedValue(streamOf([completed("")]));
    const cfg: EndpointsConfig = { ...CONFIG, chat_instructions: "You are the expression engine." };

    await collect(streamChat(cfg, req()));

    const body = createMock.mock.calls[0]?.[0];
    expect((body as any).instructions).toBe("You are the expression engine.");
  });

  it("omits `instructions` when chat_instructions is unset", async () => {
    createMock.mockResolvedValue(streamOf([completed("")]));

    await collect(streamChat(CONFIG, req()));

    const body = createMock.mock.calls[0]?.[0];
    expect("instructions" in (body as object)).toBe(false);
  });

  it("sends reasoning.effort when request.reasoning_effort is set", async () => {
    createMock.mockResolvedValue(streamOf([completed("")]));

    await collect(streamChat(CONFIG, req({ reasoning_effort: "high" })));

    const body = createMock.mock.calls[0]?.[0];
    expect((body as any).reasoning).toEqual({ effort: "high" });
  });

  it("omits `reasoning` when request.reasoning_effort is absent", async () => {
    createMock.mockResolvedValue(streamOf([completed("")]));

    await collect(streamChat(CONFIG, req()));

    const body = createMock.mock.calls[0]?.[0];
    expect("reasoning" in (body as object)).toBe(false);
  });

  it("non-empty request.instructions overrides config.chat_instructions", async () => {
    createMock.mockResolvedValue(streamOf([completed("")]));
    const cfg: EndpointsConfig = { ...CONFIG, chat_instructions: "config nudge" };

    await collect(streamChat(cfg, req({ instructions: "X" })));

    const body = createMock.mock.calls[0]?.[0];
    expect((body as any).instructions).toBe("X");
  });

  it("falls back to config.chat_instructions when request.instructions is whitespace-only", async () => {
    createMock.mockResolvedValue(streamOf([completed("")]));
    const cfg: EndpointsConfig = { ...CONFIG, chat_instructions: "config nudge" };

    await collect(streamChat(cfg, req({ instructions: "   " })));

    const body = createMock.mock.calls[0]?.[0];
    expect((body as any).instructions).toBe("config nudge");
  });

  it("falls back to config.chat_instructions when request.instructions is absent", async () => {
    createMock.mockResolvedValue(streamOf([completed("")]));
    const cfg: EndpointsConfig = { ...CONFIG, chat_instructions: "config nudge" };

    await collect(streamChat(cfg, req()));

    const body = createMock.mock.calls[0]?.[0];
    expect((body as any).instructions).toBe("config nudge");
  });

  it("omits `instructions` when neither request override nor config is set", async () => {
    createMock.mockResolvedValue(streamOf([completed("")]));

    await collect(streamChat(CONFIG, req({ instructions: "  " })));

    const body = createMock.mock.calls[0]?.[0];
    expect("instructions" in (body as object)).toBe(false);
  });
});

describe("streamChat — X-Hermes-Session-Id header", () => {
  it("sends X-Hermes-Session-Id in the create() request options when sessionId is set", async () => {
    createMock.mockResolvedValue(streamOf([completed("")]));

    await collect(streamChat(CONFIG, req(), { sessionId: "abc" }));

    expect(createMock).toHaveBeenCalledTimes(1);
    const opts = createMock.mock.calls[0]?.[1];
    expect((opts as any).headers).toBeDefined();
    expect((opts as any).headers["X-Hermes-Session-Id"]).toBe("abc");
  });

  it("omits the header (no empty-string value) when sessionId is absent", async () => {
    createMock.mockResolvedValue(streamOf([completed("")]));

    await collect(streamChat(CONFIG, req()));

    const opts = createMock.mock.calls[0]?.[1];
    // headers is either undefined or lacks the key — never an empty-string session id.
    const headers = (opts as any)?.headers;
    expect(headers?.["X-Hermes-Session-Id"]).toBeUndefined();
  });
});

describe("streamChat — usage event", () => {
  it("emits a usage event from response.completed.usage, alongside completed", async () => {
    createMock.mockResolvedValue(
      streamOf([
        textDelta("hi"),
        textDone("hi"),
        completedWithUsage("hi", {
          input_tokens: 120,
          output_tokens: 30,
          total_tokens: 150,
        }),
      ]),
    );

    const events = await collect(streamChat(CONFIG, req()));

    const usage = events.find((e) => e.type === "usage");
    expect(usage).toBeDefined();
    if (usage!.type !== "usage") throw new Error("narrow");
    expect(usage.usage).toEqual({
      input_tokens: 120,
      output_tokens: 30,
      total_tokens: 150,
    });

    // completed still rides the same turn.
    expect(events.some((e) => e.type === "completed")).toBe(true);
  });

  it("emits NO usage event when response.completed carries no usage", async () => {
    createMock.mockResolvedValue(
      streamOf([textDelta("hi"), textDone("hi"), completed("hi")]),
    );

    const events = await collect(streamChat(CONFIG, req()));

    expect(events.some((e) => e.type === "usage")).toBe(false);
    expect(events.some((e) => e.type === "completed")).toBe(true);
  });
});

describe("selectChatBaseUrl", () => {
  const CONFIGURED = "http://localhost:8643/v1";

  it("returns the configured absolute URL unchanged under Tauri", () => {
    expect(
      selectChatBaseUrl(CONFIGURED, { isTauri: true, isDev: true, origin: "http://127.0.0.1:1420" }),
    ).toBe(CONFIGURED);
  });

  it("rewrites to the same-origin proxy mount in dev web", () => {
    expect(
      selectChatBaseUrl(CONFIGURED, { isTauri: false, isDev: true, origin: "http://127.0.0.1:1420" }),
    ).toBe("http://127.0.0.1:1420/__hermes/v1");
  });

  it("returns the configured URL unchanged in prod web", () => {
    expect(
      selectChatBaseUrl(CONFIGURED, { isTauri: false, isDev: false, origin: "https://app.example" }),
    ).toBe(CONFIGURED);
  });

  it("handles a bare-path configured value in dev web", () => {
    expect(
      selectChatBaseUrl("/v1", { isTauri: false, isDev: true, origin: "http://127.0.0.1:1420" }),
    ).toBe("http://127.0.0.1:1420/__hermes/v1");
  });
});
