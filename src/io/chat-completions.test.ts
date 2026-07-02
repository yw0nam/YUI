/**
 * chat-completions.test.ts — pure Chat Completions request builders + streaming chunk reducer.
 *
 * Pins the contract for src/io/chat-completions.ts:
 *   buildCCMessages(opts) -> CC messages array
 *   buildExpressTool(emotionIds, motionIds) -> CC tool definition
 *   createChunkReducer() -> { feed(chunk), finish() }
 *
 * This module must not import from chat-client.ts (chat-client imports from it).
 */

import { describe, expect, it } from "vitest";
import type { ChatHistoryEntry } from "./chat-history-store";
import { buildCCMessages, buildExpressTool, createChunkReducer } from "./chat-completions";

// ─────────────────────────────────────────────────────────────────────────────
// buildCCMessages
// ─────────────────────────────────────────────────────────────────────────────

describe("buildCCMessages", () => {
  it("omits the instructions system message when instructions is empty/undefined", () => {
    const msgs = buildCCMessages({
      clientContextJson: '{"env":{}}',
      transcript: [],
      userText: "hi",
    });
    expect(msgs).toEqual([
      { role: "system", content: 'client_context: {"env":{}}' },
      { role: "user", content: "hi" },
    ]);
  });

  it("includes the instructions system message first when non-empty", () => {
    const msgs = buildCCMessages({
      instructions: "be terse",
      clientContextJson: "{}",
      transcript: [],
      userText: "hi",
    });
    expect(msgs[0]).toEqual({ role: "system", content: "be terse" });
    expect(msgs[1]).toEqual({ role: "system", content: "client_context: {}" });
  });

  it("maps transcript entries to role/content messages in order", () => {
    const transcript: ChatHistoryEntry[] = [
      { role: "user", text: "prior user turn", ts: 1 },
      { role: "assistant", text: "prior assistant turn", ts: 2 },
    ];
    const msgs = buildCCMessages({
      clientContextJson: "{}",
      transcript,
      userText: "new turn",
    });
    expect(msgs).toEqual([
      { role: "system", content: "client_context: {}" },
      { role: "user", content: "prior user turn" },
      { role: "assistant", content: "prior assistant turn" },
      { role: "user", content: "new turn" },
    ]);
  });

  it("final user message is plain content when no images", () => {
    const msgs = buildCCMessages({
      clientContextJson: "{}",
      transcript: [],
      userText: "no images here",
    });
    expect(msgs[msgs.length - 1]).toEqual({ role: "user", content: "no images here" });
  });

  it("final user message is a content-parts array with images first, text last", () => {
    const msgs = buildCCMessages({
      clientContextJson: "{}",
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
      clientContextJson: "{}",
      transcript: [],
      userText: "hi",
      imageDataUrls: [],
    });
    expect(msgs[msgs.length - 1]).toEqual({ role: "user", content: "hi" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildExpressTool
// ─────────────────────────────────────────────────────────────────────────────

describe("buildExpressTool", () => {
  it("declares a single function tool named generate_express", () => {
    const tool = buildExpressTool(["happy", "sad"], ["dance", "calm"]);
    expect(tool.type).toBe("function");
    expect(tool.function.name).toBe("generate_express");
    expect(typeof tool.function.description).toBe("string");
    expect(tool.function.description.length).toBeGreaterThan(0);
  });

  it("populates emotion_id/motion_id enums from inputs", () => {
    const tool = buildExpressTool(["happy", "sad"], ["dance", "calm"]);
    const props = tool.function.parameters.properties as any;
    expect(props.emotion_id).toEqual({ type: "string", enum: ["happy", "sad"] });
    expect(props.motion_id).toEqual({ type: "string", enum: ["dance", "calm"] });
    expect(props.emotion_text).toEqual({ type: "string" });
  });

  it("marks the parameters object as flat with no additional properties", () => {
    const tool = buildExpressTool([], []);
    expect(tool.function.parameters.type).toBe("object");
    expect(tool.function.parameters.additionalProperties).toBe(false);
  });

  it("empty id lists produce empty enums", () => {
    const tool = buildExpressTool([], []);
    const props = tool.function.parameters.properties as any;
    expect(props.emotion_id.enum).toEqual([]);
    expect(props.motion_id.enum).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createChunkReducer — text-only stream
// ─────────────────────────────────────────────────────────────────────────────

describe("createChunkReducer — text", () => {
  it("emits a text item per delta.content chunk", () => {
    const reducer = createChunkReducer();
    expect(reducer.feed({ choices: [{ delta: { content: "Hello" }, finish_reason: null }] })).toEqual([
      { kind: "text", text: "Hello" },
    ]);
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
      reducer.feed({ choices: [{ delta: { reasoning_content: "thinking..." }, finish_reason: null }] }),
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
          { delta: { tool_calls: [{ index: 0, function: { arguments: '{"emo' } }] }, finish_reason: null },
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
      { kind: "tool_call", id: "call_1", name: "generate_express", argsJson: '{"emotion_id":"happy"}' },
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
              { index: 0, id: "call_a", type: "function", function: { name: "generate_express", arguments: "" } },
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
              { index: 1, id: "call_b", type: "function", function: { name: "generate_express", arguments: "" } },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    reducer.feed({
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"emotion_id":"happy"}' } }] }, finish_reason: null }],
    });
    reducer.feed({
      choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: '{"emotion_id":"sad"}' } }] }, finish_reason: null }],
    });

    const items = reducer.feed({ choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    expect(items).toEqual([
      { kind: "tool_call", id: "call_a", name: "generate_express", argsJson: '{"emotion_id":"happy"}' },
      { kind: "tool_call", id: "call_b", name: "generate_express", argsJson: '{"emotion_id":"sad"}' },
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
              { index: 0, id: "call_1", type: "function", function: { name: "generate_express", arguments: '{"motion_id":"dance"}' } },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    const items = reducer.feed({ choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    expect(items).toEqual([
      { kind: "tool_call", id: "call_1", name: "generate_express", argsJson: '{"motion_id":"dance"}' },
      { kind: "finish", reason: "tool_calls" },
    ]);
  });

  it("does not JSON.parse argsJson — raw accumulated string is returned even if malformed", () => {
    const reducer = createChunkReducer();
    reducer.feed({
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "generate_express", arguments: "{not valid json" } }],
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
            tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "generate_express", arguments: '{"emotion_id":"happy"}' } }],
          },
          finish_reason: null,
        },
      ],
    });
    expect(reducer.finish()).toEqual([
      { kind: "tool_call", id: "call_1", name: "generate_express", argsJson: '{"emotion_id":"happy"}' },
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

  it("malformed tool_calls entries (missing index) are skipped", () => {
    const reducer = createChunkReducer();
    expect(
      reducer.feed({ choices: [{ delta: { tool_calls: [{ function: { arguments: "x" } }] }, finish_reason: null }] }),
    ).toEqual([]);
  });
});
