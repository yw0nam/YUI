/**
 * chat-completions.test.ts — pure Chat Completions request builders + streaming chunk reducer.
 *
 * Pins the contract for src/io/chat-completions.ts:
 *   buildCCMessages(opts) -> CC messages array
 *   createChunkReducer() -> { feed(chunk), finish() }
 *
 * This module must not import from chat-client.ts (chat-client imports from it).
 */

import { describe, expect, it } from "vitest";
import { buildCCMessages, createChunkReducer } from "./chat-completions";
import type { ChatHistoryEntry } from "./chat-history-store";

// ─────────────────────────────────────────────────────────────────────────────
// buildCCMessages
// ─────────────────────────────────────────────────────────────────────────────

describe("buildCCMessages", () => {
  it("omits the instructions system message when instructions is empty/undefined", () => {
    const msgs = buildCCMessages({
      clientContextText: "time: 2026-08-18T10:00:00+09:00 (Asia/Seoul)",
      transcript: [],
      userText: "hi",
    });
    expect(msgs).toEqual([
      {
        role: "system",
        content: "client_context:\ntime: 2026-08-18T10:00:00+09:00 (Asia/Seoul)",
      },
      { role: "user", content: "hi" },
    ]);
  });

  it("includes the instructions system message first when non-empty", () => {
    const msgs = buildCCMessages({
      instructions: "be terse",
      clientContextText: "trigger: user message",
      transcript: [],
      userText: "hi",
    });
    expect(msgs[0]).toEqual({ role: "system", content: "be terse" });
    expect(msgs[1]).toEqual({ role: "system", content: "client_context:\ntrigger: user message" });
  });

  it("maps transcript entries to role/content messages in order", () => {
    const transcript: ChatHistoryEntry[] = [
      { role: "user", text: "prior user turn", ts: 1 },
      { role: "assistant", text: "prior assistant turn", ts: 2 },
    ];
    const msgs = buildCCMessages({
      clientContextText: "trigger: user message",
      transcript,
      userText: "new turn",
    });
    expect(msgs).toEqual([
      { role: "system", content: "client_context:\ntrigger: user message" },
      { role: "user", content: "prior user turn" },
      { role: "assistant", content: "prior assistant turn" },
      { role: "user", content: "new turn" },
    ]);
  });

  it("final user message is plain content when no images", () => {
    const msgs = buildCCMessages({
      clientContextText: "trigger: user message",
      transcript: [],
      userText: "no images here",
    });
    expect(msgs[msgs.length - 1]).toEqual({ role: "user", content: "no images here" });
  });

  it("final user message is a content-parts array with images first, text last", () => {
    const msgs = buildCCMessages({
      clientContextText: "trigger: user message",
      transcript: [],
      userText: "look at this",
      imageDataUrls: ["data:image/png;base64,AAA", "data:image/png;base64,BBB"],
    });
    expect(msgs[msgs.length - 1]).toEqual({
      role: "user",
      content: [
        { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
        { type: "image_url", image_url: { url: "data:image/png;base64,BBB" } },
        { type: "text", text: "look at this" },
      ],
    });
  });

  it("empty imageDataUrls array behaves like no images", () => {
    const msgs = buildCCMessages({
      clientContextText: "trigger: user message",
      transcript: [],
      userText: "hi",
      imageDataUrls: [],
    });
    expect(msgs[msgs.length - 1]).toEqual({ role: "user", content: "hi" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createChunkReducer — text-only stream
// ─────────────────────────────────────────────────────────────────────────────

describe("createChunkReducer — text", () => {
  it("emits a text item per delta.content chunk", () => {
    const reducer = createChunkReducer();
    expect(
      reducer.feed({ choices: [{ delta: { content: "Hello" }, finish_reason: null }] }),
    ).toEqual([{ kind: "text", text: "Hello" }]);
    expect(
      reducer.feed({ choices: [{ delta: { content: " world" }, finish_reason: null }] }),
    ).toEqual([{ kind: "text", text: " world" }]);
  });

  it("emits a finish item when finish_reason arrives", () => {
    const reducer = createChunkReducer();
    reducer.feed({ choices: [{ delta: { content: "hi" }, finish_reason: null }] });
    expect(reducer.feed({ choices: [{ delta: {}, finish_reason: "stop" }] })).toEqual([
      { kind: "finish", reason: "stop" },
    ]);
  });

  it("ignores empty-string delta.content", () => {
    const reducer = createChunkReducer();
    expect(reducer.feed({ choices: [{ delta: { content: "" }, finish_reason: null }] })).toEqual(
      [],
    );
  });

  it("reasoning_content/reasoning/thinking fields never yield text items", () => {
    const reducer = createChunkReducer();
    expect(
      reducer.feed({
        choices: [{ delta: { reasoning_content: "thinking..." }, finish_reason: null }],
      }),
    ).toEqual([]);
    expect(
      reducer.feed({ choices: [{ delta: { reasoning: "hmm" }, finish_reason: null }] }),
    ).toEqual([]);
    expect(
      reducer.feed({ choices: [{ delta: { thinking: "pondering" }, finish_reason: null }] }),
    ).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createChunkReducer — tool calls
// ─────────────────────────────────────────────────────────────────────────────

describe("createChunkReducer — tool calls", () => {
  it("fragments a single tool call across 3+ chunks, name only on first fragment", () => {
    const reducer = createChunkReducer();
    expect(
      reducer.feed({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "generate_express", arguments: "" },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      }),
    ).toEqual([]);

    expect(
      reducer.feed({
        choices: [
          {
            delta: { tool_calls: [{ index: 0, function: { arguments: '{"emo' } }] },
            finish_reason: null,
          },
        ],
      }),
    ).toEqual([]);

    expect(
      reducer.feed({
        choices: [
          {
            delta: { tool_calls: [{ index: 0, function: { arguments: 'tion_id":"happy"}' } }] },
            finish_reason: null,
          },
        ],
      }),
    ).toEqual([]);

    expect(reducer.feed({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })).toEqual([
      {
        kind: "tool_call",
        id: "call_1",
        name: "generate_express",
        argsJson: '{"emotion_id":"happy"}',
      },
      { kind: "finish", reason: "tool_calls" },
    ]);
  });

  it("interleaves two parallel tool calls by index", () => {
    const reducer = createChunkReducer();
    reducer.feed({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_a",
                type: "function",
                function: { name: "generate_express", arguments: "" },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    reducer.feed({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 1,
                id: "call_b",
                type: "function",
                function: { name: "generate_express", arguments: "" },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    reducer.feed({
      choices: [
        {
          delta: { tool_calls: [{ index: 0, function: { arguments: '{"emotion_id":"happy"}' } }] },
          finish_reason: null,
        },
      ],
    });
    reducer.feed({
      choices: [
        {
          delta: { tool_calls: [{ index: 1, function: { arguments: '{"emotion_id":"sad"}' } }] },
          finish_reason: null,
        },
      ],
    });

    const items = reducer.feed({ choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    expect(items).toEqual([
      {
        kind: "tool_call",
        id: "call_a",
        name: "generate_express",
        argsJson: '{"emotion_id":"happy"}',
      },
      {
        kind: "tool_call",
        id: "call_b",
        name: "generate_express",
        argsJson: '{"emotion_id":"sad"}',
      },
      { kind: "finish", reason: "tool_calls" },
    ]);
  });

  it("tool-call-only turn (no text) still finalizes with finish_reason tool_calls", () => {
    const reducer = createChunkReducer();
    reducer.feed({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                type: "function",
                function: { name: "generate_express", arguments: '{"motion_id":"dance"}' },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    const items = reducer.feed({ choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    expect(items).toEqual([
      {
        kind: "tool_call",
        id: "call_1",
        name: "generate_express",
        argsJson: '{"motion_id":"dance"}',
      },
      { kind: "finish", reason: "tool_calls" },
    ]);
  });

  it("does not JSON.parse argsJson — raw accumulated string is returned even if malformed", () => {
    const reducer = createChunkReducer();
    reducer.feed({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                type: "function",
                function: { name: "generate_express", arguments: "{not valid json" },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    const items = reducer.feed({ choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    expect(items).toEqual([
      { kind: "tool_call", id: "call_1", name: "generate_express", argsJson: "{not valid json" },
      { kind: "finish", reason: "tool_calls" },
    ]);
  });

  it("stream end without finish_reason still flushes buffers via finish()", () => {
    const reducer = createChunkReducer();
    reducer.feed({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                type: "function",
                function: { name: "generate_express", arguments: '{"emotion_id":"happy"}' },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    expect(reducer.finish()).toEqual([
      {
        kind: "tool_call",
        id: "call_1",
        name: "generate_express",
        argsJson: '{"emotion_id":"happy"}',
      },
    ]);
    // finish() drains buffers — a second call yields nothing more
    expect(reducer.finish()).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createChunkReducer — usage
// ─────────────────────────────────────────────────────────────────────────────

describe("createChunkReducer — usage", () => {
  it("maps CC usage names to input_tokens/output_tokens/total_tokens on the final chunk", () => {
    const reducer = createChunkReducer();
    const items = reducer.feed({
      choices: [],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });
    expect(items).toEqual([
      { kind: "usage", usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createChunkReducer — malformed / defensive
// ─────────────────────────────────────────────────────────────────────────────

describe("createChunkReducer — malformed chunks", () => {
  it("null chunk produces no items and does not throw", () => {
    const reducer = createChunkReducer();
    expect(() => reducer.feed(null)).not.toThrow();
    expect(reducer.feed(null)).toEqual([]);
  });

  it("non-object chunk produces no items and does not throw", () => {
    const reducer = createChunkReducer();
    expect(reducer.feed("not an object")).toEqual([]);
    expect(reducer.feed(42)).toEqual([]);
    expect(reducer.feed(undefined)).toEqual([]);
  });

  it("chunk with non-array choices produces no items", () => {
    const reducer = createChunkReducer();
    expect(reducer.feed({ choices: "oops" })).toEqual([]);
  });

  it("chunk with missing delta produces no items and does not throw", () => {
    const reducer = createChunkReducer();
    expect(() => reducer.feed({ choices: [{ finish_reason: null }] })).not.toThrow();
    expect(reducer.feed({ choices: [{ finish_reason: null }] })).toEqual([]);
  });

  it("a tool_calls entry that is not an object is skipped", () => {
    const reducer = createChunkReducer();
    expect(
      reducer.feed({
        choices: [{ delta: { tool_calls: [null, "nope"] }, finish_reason: null }],
      }),
    ).toEqual([]);
    expect(reducer.finish()).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createChunkReducer — index-less tool_calls fragments (non-OpenAI servers)
// ─────────────────────────────────────────────────────────────────────────────

describe("createChunkReducer — tool_calls without a numeric index", () => {
  it("keeps a whole index-less call, synthesizing index 0", () => {
    const reducer = createChunkReducer();
    reducer.feed({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "generate_express", arguments: '{"emotion_id":"happy"}' },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    expect(reducer.feed({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })).toEqual([
      {
        kind: "tool_call",
        id: "call_1",
        name: "generate_express",
        argsJson: '{"emotion_id":"happy"}',
      },
      { kind: "finish", reason: "tool_calls" },
    ]);
  });

  it("accumulates index-less argument fragments into the call opened by the same id", () => {
    const reducer = createChunkReducer();
    reducer.feed({
      choices: [
        {
          delta: {
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "generate_express" } },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    reducer.feed({
      choices: [
        {
          delta: { tool_calls: [{ id: "call_1", function: { arguments: '{"emo' } }] },
          finish_reason: null,
        },
      ],
    });
    reducer.feed({
      choices: [
        {
          delta: { tool_calls: [{ function: { arguments: 'tion_id":"sad"}' } }] },
          finish_reason: null,
        },
      ],
    });
    expect(reducer.finish()).toEqual([
      {
        kind: "tool_call",
        id: "call_1",
        name: "generate_express",
        argsJson: '{"emotion_id":"sad"}',
      },
    ]);
  });

  it("separates two index-less calls by their ids", () => {
    const reducer = createChunkReducer();
    reducer.feed({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                id: "call_a",
                function: { name: "generate_express", arguments: '{"emotion_id":"happy"}' },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    reducer.feed({
      choices: [
        {
          delta: {
            tool_calls: [
              { id: "call_b", function: { name: "get_weather", arguments: '{"city":"seoul"}' } },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    expect(reducer.finish()).toEqual([
      {
        kind: "tool_call",
        id: "call_a",
        name: "generate_express",
        argsJson: '{"emotion_id":"happy"}',
      },
      { kind: "tool_call", id: "call_b", name: "get_weather", argsJson: '{"city":"seoul"}' },
    ]);
  });

  it("continues an indexed call from a fragment that carries only its id", () => {
    const reducer = createChunkReducer();
    reducer.feed({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                type: "function",
                function: { name: "generate_express", arguments: '{"emo' },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    reducer.feed({
      choices: [
        {
          delta: { tool_calls: [{ id: "call_1", function: { arguments: 'tion_id":"happy"}' } }] },
          finish_reason: null,
        },
      ],
    });
    expect(reducer.finish()).toEqual([
      {
        kind: "tool_call",
        id: "call_1",
        name: "generate_express",
        argsJson: '{"emotion_id":"happy"}',
      },
    ]);
  });

  it("keeps an index-less, id-less call at index 0", () => {
    const reducer = createChunkReducer();
    reducer.feed({
      choices: [
        {
          delta: {
            tool_calls: [
              { function: { name: "generate_express", arguments: '{"motion_id":"dance"}' } },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    expect(reducer.finish()).toEqual([
      {
        kind: "tool_call",
        id: undefined,
        name: "generate_express",
        argsJson: '{"motion_id":"dance"}',
      },
    ]);
  });
});
