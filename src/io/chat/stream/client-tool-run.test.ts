/**
 * client-tool-run.test.ts — the failed/done mapping of the request transports' tool runner.
 *
 * A body action that does not answer ok, and a query that answers an error string, report the
 * tool_status `failed` instead of `done`; the result string itself is unchanged.
 */

import { describe, expect, it } from "vitest";
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
): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  const gen = runClientCall(tools, name, argsJson);
  for (let next = await gen.next(); !next.done; next = await gen.next()) events.push(next.value);
  await gen.next();
  return events;
}

const statusesOf = (events: ChatStreamEvent[]) =>
  events.flatMap((e) => (e.type === "tool_status" ? [e.status.state] : []));

describe("runClientCall — tool_status state", () => {
  it("reports failed instead of done when a body action does not answer ok", async () => {
    const registry = createClientToolRegistry([
      tool({ timeoutResult: "timeout", execute: async () => "busy" }),
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

  it("reports done for a body action that answered ok", async () => {
    const registry = createClientToolRegistry([tool({ execute: async () => "ok" })]);
    expect(statusesOf(await collect(registry, "body_action", "{}"))).toEqual(["running", "done"]);
  });

  it("yields no tool_status for the express cue", async () => {
    const events = await collect(undefined, "generate_express", '{"emotion_id":"happy"}');
    expect(statusesOf(events)).toEqual([]);
    expect(events.some((e) => e.type === "express")).toBe(true);
  });
});
