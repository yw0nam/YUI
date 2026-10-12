/**
 * tool-calls.test.ts — the push transport's tool-call consumer.
 *
 * It refuses what the client cannot run, drops duplicates, answers stops, and runs the rest one
 * at a time in arrival order, each answered with a tool_result on the same id.
 */

import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../../../logger";
import type { ClientTool } from "../tools/client-tools";
import { createClientToolRegistry } from "../tools/client-tools";
import { fitTurnImages } from "./fit-turn-images";
import type { ToolCallFrame } from "./push-frames";
import { PUSH_FRAME_MAX_BYTES } from "./push-socket";
import { createPushToolCalls } from "./tool-calls";

vi.mock("./fit-turn-images", () => ({ fitTurnImages: vi.fn(async (images: string[]) => images) }));

function tool(
  name: string,
  execute: (args: Record<string, unknown>) => Promise<string>,
): ClientTool {
  return {
    name,
    definition: {
      type: "function",
      function: {
        name,
        description: `dummy ${name}`,
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    },
    execute,
    waitMs: 2000,
  };
}

function call(id: string, turnId: string, name: string): ToolCallFrame {
  return { type: "tool_call", id, turn_id: turnId, name, arguments: { action: "stand" } };
}

function harness(over: Partial<Parameters<typeof createPushToolCalls>[0]> = {}) {
  const sent: unknown[] = [];
  const stopped = new Set<string>();
  const deps = {
    tools: createClientToolRegistry([
      tool("body_action", async () => "ok"),
      tool("look", async () => "{}"),
    ]),
    isTurnStopped: (turnId: string) => stopped.has(turnId),
    send: vi.fn((frame: unknown) => {
      sent.push(frame);
      return true;
    }),
    execute: (tool: ClientTool, args: Record<string, unknown>) => tool.execute(args),
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as Logger,
    ...over,
  };
  return { ...deps, sent, stopped, calls: createPushToolCalls(deps) };
}

/** Let the consumer's queue unwind. */
async function flush(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

describe("createPushToolCalls", () => {
  it("answers an unknown name at once and runs nothing", async () => {
    const h = harness();
    h.calls.handle(call("c1", "t", "mcp_other_generate_express"));
    await flush();

    expect(h.sent).toEqual([
      { type: "tool_result", id: "c1", turn_id: "t", result: "error: unknown tool" },
    ]);
  });

  it("refuses a stopped turn at once and when the call starts running", async () => {
    const h = harness();
    h.stopped.add("t");
    h.calls.handle(call("c1", "t", "look"));
    await flush();
    expect(h.sent).toEqual([
      { type: "tool_result", id: "c1", turn_id: "t", result: "error: turn stopped" },
    ]);

    // A turn that is stopped while the call waits in the queue refuses when it starts.
    const release = { go: () => {} };
    const reached = new Promise<string>((r) => {
      release.go = () => r("late");
    });
    const h2 = harness({
      tools: createClientToolRegistry([tool("look", () => reached)]),
    });
    h2.calls.handle(call("c2", "t2", "look"));
    await flush();
    h2.calls.handle(call("c3", "t2", "look"));
    h2.stopped.add("t2");
    release.go();
    await flush();
    expect(h2.sent).toEqual([
      { type: "tool_result", id: "c2", turn_id: "t2", result: "late" },
      { type: "tool_result", id: "c3", turn_id: "t2", result: "error: turn stopped" },
    ]);
  });

  it("drops a duplicate id among the queued and running without answering it", async () => {
    const release = { go: () => {} };
    const gate = new Promise<string>((r) => {
      release.go = () => r("ok");
    });
    const h = harness({ tools: createClientToolRegistry([tool("look", () => gate)]) });
    h.calls.handle(call("c1", "t", "look"));
    await flush();
    h.calls.handle(call("c1", "t", "look"));
    await flush();
    release.go();
    await flush();

    expect(h.sent).toEqual([{ type: "tool_result", id: "c1", turn_id: "t", result: "ok" }]);
    expect(h.log.warn).toHaveBeenCalledWith("tool_call_duplicate", { id: "c1", name: "look" });
  });

  it("runs one call at a time in arrival order", async () => {
    const order: string[] = [];
    let release!: (result: string) => void;
    const first = new Promise<string>((r) => {
      release = r;
    });
    const h = harness({
      tools: createClientToolRegistry([
        tool("body_action", () => {
          order.push("c1");
          return first;
        }),
        tool("look", () => {
          order.push("c2");
          return Promise.resolve("{}");
        }),
      ]),
    });

    h.calls.handle(call("c1", "t", "body_action"));
    h.calls.handle(call("c2", "t", "look"));
    await flush();
    expect(order).toEqual(["c1"]);

    release("ok");
    await flush();
    expect(order).toEqual(["c1", "c2"]);

    expect(h.sent.map((frame) => (frame as { id: string }).id)).toEqual(["c1", "c2"]);
  });

  it("logs and drops a result the sink cannot send", async () => {
    const h = harness({ send: vi.fn(() => false) });
    h.calls.handle(call("c1", "t", "look"));
    await flush();

    expect(h.sent).toEqual([]);
    expect(h.log.warn).toHaveBeenCalledWith("tool_result_send_failed", { id: "c1", name: "look" });
  });

  it("keeps answering after a call whose send throws", async () => {
    const sent: unknown[] = [];
    const send = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("socket gone");
      })
      .mockImplementation((frame: unknown) => {
        sent.push(frame);
        return true;
      });
    const h = harness({ send });
    h.calls.handle(call("c1", "t", "look"));
    h.calls.handle(call("c2", "t", "look"));
    await flush();

    expect(sent).toEqual([{ type: "tool_result", id: "c2", turn_id: "t", result: "{}" }]);
    expect(h.log.warn).toHaveBeenCalledWith("tool_call_failed", {
      id: "c1",
      name: "look",
      error: "Error: socket gone",
    });
  });

  it("answers error: result too large for a result past the frame cap, counted in bytes", async () => {
    // Three bytes a character: under the cap in characters, over it in bytes.
    const big = "あ".repeat(Math.ceil(PUSH_FRAME_MAX_BYTES / 3));
    const h = harness({ tools: createClientToolRegistry([tool("look", async () => big)]) });
    h.calls.handle(call("c1", "t", "look"));
    await flush();

    expect(h.sent).toEqual([
      { type: "tool_result", id: "c1", turn_id: "t", result: "error: result too large" },
    ]);
  });
});

describe("push image results", () => {
  async function imageResult(text: string, images: string[], cap?: number, id = "c1") {
    const screen = { ...tool("look", async () => ""), execute: async () => ({ text, images }) };
    const h = harness({ tools: createClientToolRegistry([screen]), getMaxTurnBytes: () => cap });
    h.calls.handle(call(id, "t", "look"));
    await flush();
    return h.sent[0];
  }
  it("sends images above the text cap under the advertised turn cap", async () => {
    const images = [`data:image/jpeg;base64,${"a".repeat(PUSH_FRAME_MAX_BYTES)}`];
    vi.mocked(fitTurnImages).mockImplementation(async (value) => value);
    expect(await imageResult("screen", images, PUSH_FRAME_MAX_BYTES * 2)).toEqual({
      type: "tool_result",
      id: "c1",
      turn_id: "t",
      result: "screen",
      images,
    });
  });
  it("uses the turn fitter and sends its fitted images within the serialized budget", async () => {
    const images = [`data:image/jpeg;base64,${"a".repeat(1000)}`];
    const fitted = ["data:image/jpeg;base64,YQ=="];
    vi.mocked(fitTurnImages).mockClear().mockResolvedValueOnce(fitted);
    const frame = await imageResult("화면", images, 150, "識別子");
    const emptyFrame = {
      type: "tool_result",
      id: "識別子",
      turn_id: "t",
      result: "화면",
      images: [],
    };
    const budget = 150 - new TextEncoder().encode(JSON.stringify(emptyFrame)).length;
    expect(fitTurnImages).toHaveBeenCalledWith(images, budget);
    expect(frame).toEqual({
      type: "tool_result",
      id: "識別子",
      turn_id: "t",
      result: "화면",
      images: fitted,
    });
    expect(new TextEncoder().encode(JSON.stringify(frame)).length).toBeLessThanOrEqual(150);
  });
  it("removes images and returns a small error when the fitter cannot fit", async () => {
    vi.mocked(fitTurnImages).mockImplementation(async (value) => value);
    expect(await imageResult("screen", ["a".repeat(1000)], 100)).toEqual({
      type: "tool_result",
      id: "c1",
      turn_id: "t",
      result: "error: result too large",
    });
  });
  it("uses the text cap when no turn cap is advertised", async () => {
    vi.mocked(fitTurnImages).mockImplementation(async (value) => value);
    expect(await imageResult("screen", ["a".repeat(PUSH_FRAME_MAX_BYTES)])).toEqual({
      type: "tool_result",
      id: "c1",
      turn_id: "t",
      result: "error: result too large",
    });
  });
  it("counts UTF-8 ids and text against the final image frame size", async () => {
    vi.mocked(fitTurnImages).mockImplementation(async (value) => value);
    expect(
      await imageResult("한".repeat(30), ["data:image/jpeg;base64,YQ=="], 150, "識別子"),
    ).toEqual({
      type: "tool_result",
      id: "識別子",
      turn_id: "t",
      result: "error: result too large",
    });
  });
  it("keeps text-only results under 256 KiB even with a larger turn cap", async () => {
    const h = harness({
      tools: createClientToolRegistry([tool("look", async () => "a".repeat(PUSH_FRAME_MAX_BYTES))]),
      getMaxTurnBytes: () => PUSH_FRAME_MAX_BYTES * 2,
    });
    h.calls.handle(call("c1", "t", "look"));
    await flush();
    expect(h.sent).toEqual([
      { type: "tool_result", id: "c1", turn_id: "t", result: "error: result too large" },
    ]);
  });
});
