/**
 * client-tool-run.test.ts — the failed/done mapping of the request transports' tool runner.
 *
 * A body action that does not answer ok, and a query that answers an error string, report the
 * tool_status `failed` instead of `done`; the result string itself is unchanged. Arguments that do
 * not parse run nothing and answer an error result.
 */

import { describe, expect, it, vi } from "vitest";
import type { ClientTool, ClientToolRegistry } from "../tools/client-tools";
import { createClientToolRegistry } from "../tools/client-tools";
import type { ChatStreamEvent } from "./chat-client";
import { runClientCall } from "./client-tool-run";

function tool(over: Partial<ClientTool> = {}): ClientTool {
  return {
    name: "body_action",
    definition: {
      type: "function",
      function: {
        name: "body_action",
        description: "dummy",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    },
    execute: async () => "ok",
    waitMs: 2000,
    ...over,
  };
}

async function collect(
  tools: ClientToolRegistry | undefined,
  name: string,
  argsJson: string,
  signal?: AbortSignal,
  turnId?: string,
): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  const gen = runClientCall(tools, name, argsJson, signal, undefined, turnId);
  for (let next = await gen.next(); !next.done; next = await gen.next()) events.push(next.value);
  await gen.next();
  return events;
}

const statusesOf = (events: ChatStreamEvent[]) =>
  events.flatMap((e) => (e.type === "tool_status" ? [e.status.state] : []));

describe("runClientCall — the request's signal", () => {
  it("aborts the running tool's signal when the request is aborted", async () => {
    const request = new AbortController();
    let seen: AbortSignal | undefined;
    const registry = createClientToolRegistry([
      tool({
        execute: (_args, signal) => {
          seen = signal;
          request.abort();
          return Promise.resolve("ok");
        },
      }),
    ]);
    await collect(registry, "body_action", "{}", request.signal);

    expect(seen?.aborted).toBe(true);
  });
});

describe("runClientCall — the turn id", () => {
  it("hands the tool the request's turn id", async () => {
    const execute = vi.fn(async () => "ok");
    await collect(
      createClientToolRegistry([tool({ execute })]),
      "body_action",
      "{}",
      undefined,
      "t1",
    );

    expect(execute).toHaveBeenCalledWith({}, expect.any(AbortSignal), { turnId: "t1" });
  });
});

describe("runClientCall — tool_status state", () => {
  it("reports failed instead of done when a body action does not answer ok", async () => {
    const registry = createClientToolRegistry([
      tool({ failed: (result) => result !== "ok", execute: async () => "busy" }),
    ]);
    const events = await collect(registry, "body_action", "{}");

    expect(statusesOf(events)).toEqual(["running", "failed"]);
  });

  it("reports failed when a query answers an error string, done when it answers", async () => {
    const registry = createClientToolRegistry([
      tool({ name: "look", execute: async () => "error: no reply" }),
    ]);
    expect(statusesOf(await collect(registry, "look", "{}"))).toEqual(["running", "failed"]);

    const okRegistry = createClientToolRegistry([
      tool({ name: "look", execute: async () => "{}" }),
    ]);
    expect(statusesOf(await collect(okRegistry, "look", "{}"))).toEqual(["running", "done"]);
  });

  it("lets a tool say what a failed result is", async () => {
    const registry = createClientToolRegistry([
      tool({ failed: (result) => result === "nope", execute: async () => "error: but fine" }),
    ]);
    expect(statusesOf(await collect(registry, "body_action", "{}"))).toEqual(["running", "done"]);
  });

  it("answers unparseable arguments with a failed status and an error result, without running the tool", async () => {
    const execute = vi.fn(async () => "ok");
    const registry = createClientToolRegistry([tool({ execute })]);
    const gen = runClientCall(registry, "body_action", "{not json");
    const events: ChatStreamEvent[] = [];
    let next = await gen.next();
    for (; !next.done; next = await gen.next()) events.push(next.value);

    expect(statusesOf(events)).toEqual(["running", "failed"]);
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    expect(next.value?.run?.result).toMatch(/^error: arguments JSON parse failed: /);
    expect(next.value?.run?.oneWay).toBe(false);
  });

  it("yields no tool_status for the express cue", async () => {
    const events = await collect(undefined, "generate_express", '{"emotion_id":"happy"}');
    expect(statusesOf(events)).toEqual([]);
    expect(events.some((e) => e.type === "express")).toBe(true);
  });
});

describe("runClientCall — image result status", () => {
  it.each([
    ["screenshot of display 0", "done"],
    ["error: capture denied", "failed"],
  ])("classifies object text %s as %s", async (text, state) => {
    const registry = createClientToolRegistry([
      tool({
        name: "look",
        execute: async () => ({ text, images: ["data:image/jpeg;base64,YQ=="] }),
      }),
    ]);
    expect(statusesOf(await collect(registry, "look", "{}"))).toEqual(["running", state]);
  });
  it("passes object text to the custom failed predicate", async () => {
    const failed = vi.fn((text: string) => text === "nope");
    const registry = createClientToolRegistry([
      tool({ failed, execute: async () => ({ text: "nope", images: [] }) }),
    ]);
    expect(statusesOf(await collect(registry, "body_action", "{}"))).toEqual(["running", "failed"]);
    expect(failed).toHaveBeenCalledWith("nope");
  });
});
