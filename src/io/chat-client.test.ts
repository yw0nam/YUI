/**
 * chat-client.test.ts — openai-SDK adapter.
 *
 * Verify: streamChat(config, request) maps the official `openai` SDK's
 *   client.responses.create({ stream: true }) → async-iterable of TYPED Responses events
 * to our ChatStreamEvent / ControlEnvelope.
 *
 * Decision D-CHAT-SDK: SSE framing/chunk-split/abort are SDK-owned.
 * → Never mock fetch/ReadableStream/raw-bytes. Mock the `openai` module instead.
 *
 * Event shape source: openai@6.42 d.ts.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { EndpointsConfig } from "../contract";
import {
  type ChatRequest,
  type ChatStreamEvent,
  selectChatBaseUrl,
  streamChat,
} from "./chat-client";

// ── openai SDK mock ──────────────────────────────────────────────────────────
// new OpenAI(opts) → { responses: { create: createMock } }.
const createMock = vi.fn();
vi.mock("openai", () => ({
  default: vi.fn(() => ({ responses: { create: createMock } })),
}));

afterEach(() => vi.clearAllMocks());

// ── helpers ──────────────────────────────────────────────────────────────────

/** Typed SDK event array → async-iterable (mock responses.create stream result). */
async function* streamOf(events: any[]): AsyncGenerator<any> {
  for (const ev of events) yield ev;
}

/** Consumes the generator completely and collects yielded ChatStreamEvent objects. */
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

// Event builders (verified shapes) ──────────────────────────────────────────────────
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
  item: {
    type: "function_call",
    id,
    name,
    call_id: `call_${id}`,
    arguments: "",
    status: "in_progress",
  },
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
  item: {
    type: "function_call",
    id,
    name,
    call_id: `call_${id}`,
    arguments: args,
    status: "in_progress",
  },
  sequence_number: 0,
});

const fnArgsDone = (name: string, item_id: string, output_index: number, args: string): any => ({
  type: "response.function_call_arguments.done",
  item_id,
  output_index,
  name, // ← name IS present here; express is identified here
  arguments: args,
});

const fnItemDone = (name: string, id: string, output_index: number, args: string): any => ({
  type: "response.output_item.done",
  output_index,
  item: { type: "function_call", id, name, arguments: args, status: "completed" },
});

/** response.completed — output[] contains only message items; function_call is absent. */
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
const completedWithUsage = (text: string, usage: Record<string, unknown>): any => {
  const ev = completed(text);
  ev.response.usage = usage;
  return ev;
};

/** response.reasoning_summary_text.delta — no ChatStreamEvent case handled it before the fix. */
const reasoningSummaryDelta = (delta: string): any => ({
  type: "response.reasoning_summary_text.delta",
  delta,
  item_id: "rs_1",
  output_index: 0,
  summary_index: 0,
  sequence_number: 0,
});

/** response.reasoning_text.delta — same "unhandled reasoning event" family. */
const reasoningTextDelta = (delta: string): any => ({
  type: "response.reasoning_text.delta",
  delta,
  item_id: "rs_1",
  output_index: 0,
  content_index: 0,
  sequence_number: 0,
});

/** generate_express FLAT args: emotion_id / motion_id / emotion_text. */
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
    if (express?.type !== "express") throw new Error("narrow");
    // FLAT shape — no nested emotion/motion objects.
    expect(express.args.emotion_id).toBe("happy");
    expect(express.args.motion_id).toBe("embarrassed");
    expect(express.args.emotion_text).toBe("[whisper in small voice]");
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
    if (final?.type !== "completed") throw new Error("narrow");
    const env = final.envelope;
    // Text and generate_express are merged into a single normalized envelope.
    expect(env.speech_text).toBe("안녕");
    // Normalized to the unchanged downstream renderer seam (EmotionSignal / MotionSignal).
    expect(env.emotion).toEqual({ id: "happy" });
    expect(env.motion).toEqual({ id: "embarrassed" });
    expect(env.emotion_text).toBe("[whisper in small voice]");
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
    if (final?.type !== "completed") throw new Error("narrow");
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
    // Sanity: lock down that the final payload has no function_call.
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

    // web_search does not leak as express.
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
    if (final?.type !== "completed") throw new Error("narrow");
    const env = final.envelope;
    expect(env.speech_text).toBe("그냥 텍스트");
    // Parser does not invent idle/prior defaults — that is the consumer's job.
    expect(env.emotion).toBeUndefined();
    expect(env.motion).toBeUndefined();
    expect(env.emotion_text).toBeUndefined();
    // Silence is represented as empty speech_text — no speak gate on client.
  });
});

// ── LIVE Hermes backend shape ────────────────────────────────────────────
// Verified stream: express tool is MCP-namespaced and its args ride inside
// output_item.added/done (item.arguments); NO function_call_arguments.* events.
describe("streamChat — live MCP-namespaced generate_express", () => {
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
    if (express?.type !== "express") throw new Error("narrow");
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
    if (final?.type !== "completed") throw new Error("narrow");
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
    if (final?.type !== "completed") throw new Error("narrow");
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

// ── per-beat cues: MULTIPLE generate_express per reply ───────────────────
// Hermes emits one generate_express per expressive beat. EVERY distinct call must
// surface as its own express event, deduped PER CALL (added/done share one id).
describe("streamChat — per-beat cues (multiple generate_express)", () => {
  const CUE_A = '{"emotion_id":"happy","motion_id":"wave","emotion_text":"[cheerful warm tone]"}';
  const CUE_B = '{"emotion_id":"thinking","motion_id":"nod","emotion_text":"[soft pondering]"}';

  it("two distinct generate_express calls → two express events with their respective args", async () => {
    createMock.mockResolvedValue(
      streamOf([
        fnAddedWithArgs(MCP_GEN_EXPRESS, "fc_a", 0, CUE_A),
        fnItemDone(MCP_GEN_EXPRESS, "fc_a", 0, CUE_A),
        textDelta("hi "),
        fnAddedWithArgs(MCP_GEN_EXPRESS, "fc_b", 1, CUE_B),
        fnItemDone(MCP_GEN_EXPRESS, "fc_b", 1, CUE_B),
        textDelta("there"),
        textDone("hi there"),
        completed("hi there"),
      ]),
    );

    const events = await collect(streamChat(CONFIG, req()));
    const express = events.filter((e) => e.type === "express");
    expect(express.length).toBe(2);
    if (express[0].type !== "express" || express[1].type !== "express") throw new Error("narrow");
    expect(express[0].args).toEqual({
      emotion_id: "happy",
      motion_id: "wave",
      emotion_text: "[cheerful warm tone]",
    });
    expect(express[1].args).toEqual({
      emotion_id: "thinking",
      motion_id: "nod",
      emotion_text: "[soft pondering]",
    });
  });

  it("two distinct calls on the function_call_arguments.done path dedup by item_id → two express events (args A then B)", async () => {
    createMock.mockResolvedValue(
      streamOf([
        fnAdded("generate_express", "fc_a", 0),
        fnArgsDone("generate_express", "fc_a", 0, CUE_A),
        textDelta("hi "),
        fnAdded("generate_express", "fc_b", 1),
        fnArgsDone("generate_express", "fc_b", 1, CUE_B),
        textDone("hi"),
        completed("hi"),
      ]),
    );

    const events = await collect(streamChat(CONFIG, req()));
    const express = events.filter((e) => e.type === "express");
    expect(express.length).toBe(2);
    if (express[0].type !== "express" || express[1].type !== "express") throw new Error("narrow");
    expect(express[0].args).toEqual({
      emotion_id: "happy",
      motion_id: "wave",
      emotion_text: "[cheerful warm tone]",
    });
    expect(express[1].args).toEqual({
      emotion_id: "thinking",
      motion_id: "nod",
      emotion_text: "[soft pondering]",
    });
  });

  it("one call surfaced in BOTH added and done (same id) → exactly one express event", async () => {
    createMock.mockResolvedValue(
      streamOf([
        fnAddedWithArgs(MCP_GEN_EXPRESS, "fc_a", 0, CUE_A),
        fnItemDone(MCP_GEN_EXPRESS, "fc_a", 0, CUE_A),
        completed(""),
      ]),
    );

    const events = await collect(streamChat(CONFIG, req()));
    expect(events.filter((e) => e.type === "express").length).toBe(1);
  });

  it("a get_ids-style tool call (name ending _get_ids, args {}) yields NO express event", async () => {
    createMock.mockResolvedValue(
      streamOf([
        fnAdded(MCP_GET_IDS, "fc_g", 0),
        fnItemDone(MCP_GET_IDS, "fc_g", 0, "{}"),
        completed(""),
      ]),
    );

    const events = await collect(streamChat(CONFIG, req()));
    expect(events.some((e) => e.type === "express")).toBe(false);
  });

  it("completed envelope reflects the LAST cue when multiple cues were sent", async () => {
    createMock.mockResolvedValue(
      streamOf([
        fnAddedWithArgs(MCP_GEN_EXPRESS, "fc_a", 0, CUE_A),
        fnItemDone(MCP_GEN_EXPRESS, "fc_a", 0, CUE_A),
        fnAddedWithArgs(MCP_GEN_EXPRESS, "fc_b", 1, CUE_B),
        fnItemDone(MCP_GEN_EXPRESS, "fc_b", 1, CUE_B),
        completed(""),
      ]),
    );

    const events = await collect(streamChat(CONFIG, req()));
    const final = events.find((e) => e.type === "completed");
    if (final?.type !== "completed") throw new Error("narrow");
    const env = final.envelope;
    // last cue (CUE_B) wins the fallback envelope, not the first.
    expect(env.emotion).toEqual({ id: "thinking" });
    expect(env.motion).toEqual({ id: "nod" });
    expect(env.emotion_text).toBe("[soft pondering]");
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
    // NOTE for implementer: when generate_express arguments are broken JSON — assume it emits error.
    // (Alternative: silently skip. Update this test when confirmed.) Core guarantee: generator does not throw
    // and runs normally to completed.
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
    // Despite broken express, stream runs to completion and emits completed.
    expect(events.some((e) => e.type === "completed")).toBe(true);
  });
});

describe("streamChat — create() rejection carries HTTP status", () => {
  it("openai SDK APIError with status 401 → error event includes status: 401", async () => {
    createMock.mockRejectedValue(
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

  it("openai SDK APIError with status 403 → error event includes status: 403", async () => {
    createMock.mockRejectedValue(Object.assign(new Error("403 Forbidden"), { status: 403 }));

    const events = await collect(streamChat(CONFIG, req()));

    expect(events).toEqual([
      { type: "error", message: "chat request failed: 403 Forbidden", status: 403 },
    ]);
  });

  it("a plain error with no status field → error event omits status (back-compat)", async () => {
    createMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const events = await collect(streamChat(CONFIG, req()));

    expect(events).toEqual([{ type: "error", message: "chat request failed: ECONNREFUSED" }]);
    expect(events[0] && "status" in events[0]).toBe(false);
  });
});

describe("streamChat — abort", () => {
  it("already-aborted signal → generator terminates cleanly (no hang)", async () => {
    const ac = new AbortController();
    ac.abort();
    // SDK may throw on aborted signal, so mock it as rejection.
    createMock.mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));

    // NOTE for implementer: streamChat must terminate without hang on already-aborted signal
    // (terminate silently or emit error once). Both acceptable — core is generator finishes.
    let events: ChatStreamEvent[] = [];
    await expect(async () => {
      events = await collect(streamChat(CONFIG, req({ signal: ac.signal })));
    }).not.toThrow();

    // If error emitted, exactly once; otherwise 0. Either way, terminates cleanly.
    expect(events.filter((e) => e.type !== "error").length).toBe(0);
  });

  it("forwards request.signal into the SDK create() options", async () => {
    // NOTE for implementer: strengthen this once signal wiring shape is confirmed —
    // currently just softly checking that the same AbortSignal is passed in create() options object.
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

  it("passes previous_response_id as undefined when absent (first turn — SDK drops it, never sends null)", async () => {
    createMock.mockResolvedValue(streamOf([completed("")]));

    await collect(streamChat(CONFIG, req()));

    const body = createMock.mock.calls[0]?.[0];
    expect((body as any).previous_response_id).toBeUndefined();
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

    await collect(streamChat(CONFIG, req({ reasoning_effort: "none" })));

    const body = createMock.mock.calls[0]?.[0];
    expect((body as any).reasoning).toEqual({ effort: "none" });
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

describe("streamChat — no custom session header", () => {
  it("never sends an X-Hermes-Session-Id header in the create() request options", async () => {
    createMock.mockResolvedValue(streamOf([completed("")]));

    await collect(streamChat(CONFIG, req()));

    expect(createMock).toHaveBeenCalledTimes(1);
    const opts = createMock.mock.calls[0]?.[1];
    expect((opts as any)?.headers?.["X-Hermes-Session-Id"]).toBeUndefined();
  });
});

describe("streamChat — completed responseId", () => {
  it("surfaces response.id on the completed event", async () => {
    const ev = completed("hi");
    ev.response.id = "resp_abc";
    ev.response.usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 };
    createMock.mockResolvedValue(streamOf([textDelta("hi"), textDone("hi"), ev]));

    const events = await collect(streamChat(CONFIG, req()));
    const final = events.find((e) => e.type === "completed");
    expect(final).toBeDefined();
    if (final?.type !== "completed") throw new Error("narrow");
    expect(final.responseId).toBe("resp_abc");
  });

  it("defaults responseId to '' when response.id is absent", async () => {
    const ev = completed("hi");
    delete ev.response.id;
    createMock.mockResolvedValue(streamOf([textDone("hi"), ev]));

    const events = await collect(streamChat(CONFIG, req()));
    const final = events.find((e) => e.type === "completed");
    if (final?.type !== "completed") throw new Error("narrow");
    expect(final.responseId).toBe("");
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
    if (usage?.type !== "usage") throw new Error("narrow");
    expect(usage.usage).toEqual({
      input_tokens: 120,
      output_tokens: 30,
      total_tokens: 150,
    });

    // completed still rides the same turn.
    expect(events.some((e) => e.type === "completed")).toBe(true);
  });

  it("emits NO usage event when response.completed carries no usage", async () => {
    createMock.mockResolvedValue(streamOf([textDelta("hi"), textDone("hi"), completed("hi")]));

    const events = await collect(streamChat(CONFIG, req()));

    expect(events.some((e) => e.type === "usage")).toBe(false);
    expect(events.some((e) => e.type === "completed")).toBe(true);
  });
});

describe("streamChat — reasoning keepalive", () => {
  it("emits keepalive for response.reasoning_summary_text.delta and response.reasoning_text.delta, before the first speech_delta", async () => {
    createMock.mockResolvedValue(
      streamOf([
        reasoningSummaryDelta("thinking..."),
        reasoningTextDelta("more thinking..."),
        textDelta("hi"),
        textDone("hi"),
        completed("hi"),
      ]),
    );

    const events = await collect(streamChat(CONFIG, req()));

    const keepalives = events.filter((e) => e.type === "keepalive");
    expect(keepalives.length).toBe(2);

    // keepalives must precede the first speech_delta — they cover the reasoning gap.
    const firstSpeechIdx = events.findIndex((e) => e.type === "speech_delta");
    const lastKeepaliveIdx = events.map((e) => e.type).lastIndexOf("keepalive");
    expect(lastKeepaliveIdx).toBeLessThan(firstSpeechIdx);
  });

  it("a lone reasoning event with no following text still yields a keepalive (no speech required)", async () => {
    createMock.mockResolvedValue(streamOf([reasoningSummaryDelta("thinking..."), completed("")]));

    const events = await collect(streamChat(CONFIG, req()));

    expect(events).toContainEqual({ type: "keepalive" });
  });
});

describe("selectChatBaseUrl", () => {
  const CONFIGURED = "http://localhost:8643/v1";

  it("returns the configured absolute URL unchanged under Tauri", () => {
    expect(
      selectChatBaseUrl(CONFIGURED, {
        isTauri: true,
        isDev: true,
        origin: "http://127.0.0.1:1420",
      }),
    ).toBe(CONFIGURED);
  });

  it("rewrites to the same-origin proxy mount in dev web", () => {
    expect(
      selectChatBaseUrl(CONFIGURED, {
        isTauri: false,
        isDev: true,
        origin: "http://127.0.0.1:1420",
      }),
    ).toBe("http://127.0.0.1:1420/__hermes/v1");
  });

  it("returns the configured URL unchanged in prod web", () => {
    expect(
      selectChatBaseUrl(CONFIGURED, {
        isTauri: false,
        isDev: false,
        origin: "https://app.example",
      }),
    ).toBe(CONFIGURED);
  });

  it("handles a bare-path configured value in dev web", () => {
    expect(
      selectChatBaseUrl("/v1", { isTauri: false, isDev: true, origin: "http://127.0.0.1:1420" }),
    ).toBe("http://127.0.0.1:1420/__hermes/v1");
  });

  // Chat Completions mode: the /__hermes dev-web proxy mount is hardcoded to the Responses
  // backend — CC must never be silently rewritten onto it, in any environment.
  it("chat_completions + dev web: returns the configured URL as-is (no /__hermes rewrite)", () => {
    expect(
      selectChatBaseUrl(
        CONFIGURED,
        { isTauri: false, isDev: true, origin: "http://127.0.0.1:1420" },
        "chat_completions",
      ),
    ).toBe(CONFIGURED);
  });

  it("chat_completions + tauri: unchanged passthrough (same as before)", () => {
    expect(
      selectChatBaseUrl(
        CONFIGURED,
        { isTauri: true, isDev: true, origin: "http://127.0.0.1:1420" },
        "chat_completions",
      ),
    ).toBe(CONFIGURED);
  });

  it("chat_completions + prod web: unchanged passthrough (same as before)", () => {
    expect(
      selectChatBaseUrl(
        CONFIGURED,
        { isTauri: false, isDev: false, origin: "https://app.example" },
        "chat_completions",
      ),
    ).toBe(CONFIGURED);
  });

  it("responses mode (chat_api omitted) is unaffected — still rewrites in dev web", () => {
    expect(
      selectChatBaseUrl(CONFIGURED, {
        isTauri: false,
        isDev: true,
        origin: "http://127.0.0.1:1420",
      }),
    ).toBe("http://127.0.0.1:1420/__hermes/v1");
  });

  it("responses mode (chat_api explicit 'responses') is unaffected — still rewrites in dev web", () => {
    expect(
      selectChatBaseUrl(
        CONFIGURED,
        { isTauri: false, isDev: true, origin: "http://127.0.0.1:1420" },
        "responses",
      ),
    ).toBe("http://127.0.0.1:1420/__hermes/v1");
  });
});
