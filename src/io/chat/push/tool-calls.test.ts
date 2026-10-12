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
import type { ToolCallFrame } from "./push-frames";
import { createPushToolCalls } from "./tool-calls";

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
    push: true,
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
});
