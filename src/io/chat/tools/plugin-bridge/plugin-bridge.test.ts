/**
 * plugin-bridge.test.ts — the bridge tools over the MCP host.
 *
 * The describe tool answers a tool's description and schema, the call tool runs it, and the
 * skill tool reads a skill's body.
 */

import { describe, expect, it, vi } from "vitest";
import type { McpHost, PluginHostSnapshot } from "../../../mcp-host/mcp-host";
import { type ClientTool, toolFailed } from "../client-tools";
import { executeClientTool } from "../execute";
import { createTerminalTools } from "../terminal/terminal-tools";
import { createPluginBridgeTools } from "./plugin-bridge";

const SNAPSHOT: PluginHostSnapshot = {
  revision: 1,
  plugins: [
    {
      id: "p1",
      version: null,
      description: null,
      source: "local",
      path: "/plugins/p1",
      enabled: true,
      consented: true,
      error: null,
      servers: [],
      tools: [
        {
          name: "echo_args",
          server: "p1/s",
          description: "Echoes its arguments.",
          inputSchema: { type: "object", properties: { n: { type: "integer" } }, required: ["n"] },
          meta: { "io.github.yw0nam.yui/summary": "Echo argv." },
        },
      ],
      skills: [{ name: "hello", description: "Says hello." }],
      hidden: [],
    },
  ],
};

function fakeHost(over: Partial<McpHost> = {}): McpHost {
  return {
    snapshot: () => SNAPSHOT,
    call: vi.fn(async () => ({ content: [{ type: "text", text: "echoed" }], isError: false })),
    cancel: vi.fn(async () => {}),
    skill: vi.fn(async () => "# hello"),
    subscribe: vi.fn(() => () => {}),
    ...over,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("yui_tool_describe", () => {
  it("answers a plugin tool's name, description and input schema", async () => {
    const [describe] = createPluginBridgeTools({ host: fakeHost(), presetId: () => "p1", onDemand: [] });

    await expect(describe.execute({ name: "echo_args" })).resolves.toBe(
      'name: echo_args\ndescription: Echoes its arguments.\ninput schema: {"type":"object","properties":{"n":{"type":"integer"}},"required":["n"]}',
    );
  });

  it("answers an unknown name", async () => {
    const [describe] = createPluginBridgeTools({ host: fakeHost(), presetId: () => "p1", onDemand: [] });

    await expect(describe.execute({ name: "nope" })).resolves.toBe(
      "error: unknown tool: nope",
    );
  });
});

describe("yui_tool_call", () => {
  it("rejects arguments that break the tool's schema, without calling the host", async () => {
    const host = fakeHost();
    const [, call] = createPluginBridgeTools({ host, presetId: () => "p1", onDemand: [] });

    const result = await call.execute({ name: "echo_args", arguments: { n: "x" } });

    expect(String(result)).toMatch(/^error: invalid arguments \(#\/n:/);
    expect(String(result)).toContain("\ninput schema: {");
    expect(host.call).not.toHaveBeenCalled();
  });

  it("rejects arguments that arrived as a string", async () => {
    const host = fakeHost();
    const [, call] = createPluginBridgeTools({ host, presetId: () => "p1", onDemand: [] });

    const result = await call.execute({ name: "echo_args", arguments: '{"n":1}' });

    expect(result).toBe(
      'error: invalid arguments (#: Instance type "string" is invalid. Expected "object".)\n' +
        'input schema: {"type":"object","properties":{"n":{"type":"integer"}},"required":["n"]}',
    );
    expect(host.call).not.toHaveBeenCalled();
  });

  it("calls the host with the tool's name, arguments and the window's preset", async () => {
    const host = fakeHost();
    const [, call] = createPluginBridgeTools({ host, presetId: () => "p1", onDemand: [] });

    const result = await call.execute({ name: "echo_args", arguments: { n: 1 } });

    const [callId, name, args, presetId] = vi.mocked(host.call).mock.calls[0]!;
    expect(callId).toMatch(UUID);
    expect(name).toBe("echo_args");
    expect(args).toEqual({ n: 1 });
    expect(presetId).toBe("p1");
    expect(result).toBe("echoed");
  });

  it("cancels the host call when the turn is aborted", async () => {
    const abort = new AbortController();
    let callId = "";
    const host = fakeHost({
      call: vi.fn(async (id: string) => {
        callId = id;
        await new Promise((resolve) => abort.signal.addEventListener("abort", resolve));
        return { content: [], isError: false };
      }),
    });
    const [, call] = createPluginBridgeTools({ host, presetId: () => "p1", onDemand: [] });

    const running = call.execute({ name: "echo_args", arguments: { n: 1 } }, abort.signal);
    await vi.waitFor(() => expect(callId).not.toBe(""));
    abort.abort();
    await running;

    expect(host.cancel).toHaveBeenCalledWith(callId);
  });

  it("names the status chip after the plugin tool it calls", () => {
    const [, call] = createPluginBridgeTools({ host: fakeHost(), presetId: () => "p1", onDemand: [] });

    expect(call.statusId?.({ name: "echo_args" })).toBe("echo_args");
  });

  it("reads a result as failed when it keeps the plugin's error or unknown prefix", () => {
    const [, call] = createPluginBridgeTools({ host: fakeHost(), presetId: () => "p1", onDemand: [] });

    expect(toolFailed(call, "error: x")).toBe(true);
    expect(toolFailed(call, "unknown: x")).toBe(true);
    expect(toolFailed(call, "ok")).toBe(false);
  });
});

describe("plugin_skill", () => {
  it("answers the skill's body", async () => {
    const [, , skill] = createPluginBridgeTools({ host: fakeHost(), presetId: () => "p1", onDemand: [] });

    await expect(skill.execute({ name: "hello" })).resolves.toBe("# hello");
  });
});


describe("on-demand built-ins", () => {
  const builtin: ClientTool = {
    name: "echo_args",
    definition: { type: "function", function: {
      name: "echo_args", description: "Built-in echo.",
      parameters: { type: "object", properties: { n: { type: "integer" } }, required: ["n"], additionalProperties: false },
    } },
    execute: async () => "built-in result",
    waitMs: 2000,
  };

  it("describes a built-in before a plugin with the same name", async () => {
    const [describe] = createPluginBridgeTools({ host: fakeHost(), presetId: () => "p1", onDemand: [builtin] });
    await expect(describe.execute({ name: "echo_args" })).resolves.toBe(
      'name: echo_args\ndescription: Built-in echo.\ninput schema: {"type":"object","properties":{"n":{"type":"integer"}},"required":["n"],"additionalProperties":false}',
    );
  });

  it.each([
    [{ n: 1 }, "built-in result"],
    [{ n: "x" }, 'error: invalid arguments (#/n: Instance type "string" is invalid. Expected "integer".)\ninput schema: {"type":"object","properties":{"n":{"type":"integer"}},"required":["n"],"additionalProperties":false}'],
  ])("calls a built-in with %j", async (args, expected) => {
    const [, call] = createPluginBridgeTools({ host: fakeHost(), presetId: () => "p1", onDemand: [builtin] });
    await expect(call.execute({ name: "echo_args", arguments: args })).resolves.toBe(expected);
  });

  it("rejects an unknown call name", async () => {
    const [, call] = createPluginBridgeTools({ host: fakeHost(), presetId: () => "p1", onDemand: [] });
    await expect(call.execute({ name: "missing", arguments: {} })).resolves.toBe("error: unknown tool: missing");
  });

  it("keeps a terminal read's own wait and cancels its access request", async () => {
    vi.useFakeTimers();
    try {
      const invoke = vi.fn(async () => await new Promise<string>(() => {}));
      const [, call] = createPluginBridgeTools({ host: fakeHost(), presetId: () => "p1",
        onDemand: createTerminalTools({ presetId: () => "p1", invoke }) });
      const running = executeClientTool(call, { name: "terminal_read", arguments: { id: "t1" } });
      await vi.advanceTimersByTimeAsync(70_000);
      await expect(running).resolves.toBe("error: timed out after 70 s");
      expect(invoke.mock.calls.map(([command]) => command)).toEqual(["terminal_tool_read", "terminal_tool_cancel"]);
    } finally { vi.useRealTimers(); }
  });

  it("marks a denied terminal call as failed", () => {
    const [, call] = createPluginBridgeTools({ host: fakeHost(), presetId: () => "p1", onDemand: [] });
    expect(toolFailed(call, "denied: no answer in 60 s")).toBe(true);
  });
});
