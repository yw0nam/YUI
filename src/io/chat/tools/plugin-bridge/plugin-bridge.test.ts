/**
 * plugin-bridge.test.ts — the bridge tools over the MCP host.
 *
 * The describe tool answers a tool's description and schema, the call tool runs it, and the
 * skill tool reads a skill's body.
 */

import { describe, expect, it, vi } from "vitest";
import type { McpHost, PluginHostSnapshot } from "../../../mcp-host/mcp-host";
import { toolFailed } from "../client-tools";
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

describe("plugin_describe", () => {
  it("answers a plugin tool's name, description and input schema", async () => {
    const [describe] = createPluginBridgeTools({ host: fakeHost(), presetId: () => "p1" });

    await expect(describe.execute({ name: "echo_args" })).resolves.toBe(
      'name: echo_args\ndescription: Echoes its arguments.\ninput schema: {"type":"object","properties":{"n":{"type":"integer"}},"required":["n"]}',
    );
  });

  it("answers an unknown name", async () => {
    const [describe] = createPluginBridgeTools({ host: fakeHost(), presetId: () => "p1" });

    await expect(describe.execute({ name: "nope" })).resolves.toBe(
      "error: unknown plugin tool: nope",
    );
  });
});

describe("plugin_call", () => {
  it("rejects arguments that break the tool's schema, without calling the host", async () => {
    const host = fakeHost();
    const [, call] = createPluginBridgeTools({ host, presetId: () => "p1" });

    const result = await call.execute({ name: "echo_args", arguments: { n: "x" } });

    expect(String(result)).toMatch(/^error: invalid arguments \(#\/n:/);
    expect(String(result)).toContain("\ninput schema: {");
    expect(host.call).not.toHaveBeenCalled();
  });

  it("rejects arguments that arrived as a string", async () => {
    const host = fakeHost();
    const [, call] = createPluginBridgeTools({ host, presetId: () => "p1" });

    const result = await call.execute({ name: "echo_args", arguments: '{"n":1}' });

    expect(result).toBe(
      'error: invalid arguments (#: Instance type "string" is invalid. Expected "object".)\n' +
        'input schema: {"type":"object","properties":{"n":{"type":"integer"}},"required":["n"]}',
    );
    expect(host.call).not.toHaveBeenCalled();
  });

  it("calls the host with the tool's name, arguments and the window's preset", async () => {
    const host = fakeHost();
    const [, call] = createPluginBridgeTools({ host, presetId: () => "p1" });

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
    const [, call] = createPluginBridgeTools({ host, presetId: () => "p1" });

    const running = call.execute({ name: "echo_args", arguments: { n: 1 } }, abort.signal);
    await vi.waitFor(() => expect(callId).not.toBe(""));
    abort.abort();
    await running;

    expect(host.cancel).toHaveBeenCalledWith(callId);
  });

  it("names the status chip after the plugin tool it calls", () => {
    const [, call] = createPluginBridgeTools({ host: fakeHost(), presetId: () => "p1" });

    expect(call.statusId?.({ name: "echo_args" })).toBe("echo_args");
  });

  it("reads a result as failed when it keeps the plugin's error or unknown prefix", () => {
    const [, call] = createPluginBridgeTools({ host: fakeHost(), presetId: () => "p1" });

    expect(toolFailed(call, "error: x")).toBe(true);
    expect(toolFailed(call, "unknown: x")).toBe(true);
    expect(toolFailed(call, "ok")).toBe(false);
  });
});

describe("plugin_skill", () => {
  it("answers the skill's body", async () => {
    const [, , skill] = createPluginBridgeTools({ host: fakeHost(), presetId: () => "p1" });

    await expect(skill.execute({ name: "hello" })).resolves.toBe("# hello");
  });
});
