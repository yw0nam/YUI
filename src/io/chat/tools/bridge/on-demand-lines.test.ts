import { expect, it, vi } from "vitest";
import type { McpHost, PluginHostPlugin } from "../../../mcp-host/mcp-host";
import type { ClientTool } from "../client-tools";
import { onDemandLines } from "./on-demand-lines";

it("lists built-in On-demand tools before enabled plugin tools and preserves skills", () => {
  const plugin: PluginHostPlugin = {
    id: "p1",
    version: null,
    description: null,
    source: "local",
    path: "/plugins/p1",
    enabled: true,
    consented: true,
    error: null,
    servers: [],
    hidden: [],
    tools: [
      {
        name: "echo_args",
        server: "p1/s",
        description: "Echo arguments. Returns text.",
        inputSchema: { type: "object" },
        meta: null,
      },
    ],
    skills: [
      { name: "hello", description: "Say hello." },
      { name: "read", description: "Read a page." },
    ],
  };
  const host: McpHost = {
    snapshot: () => ({
      revision: 1,
      plugins: [
        {
          ...plugin,
          id: "off",
          enabled: false,
          tools: [{ ...plugin.tools[0]!, name: "hidden" }],
          skills: [{ name: "hidden", description: "Hidden." }],
        },
        plugin,
      ],
    }),
    call: vi.fn(),
    cancel: vi.fn(),
    skill: vi.fn(),
    subscribe: vi.fn(),
  };
  const builtin = (name: string, description: string): ClientTool => ({
    name,
    definition: {
      type: "function",
      function: { name, description, parameters: { type: "object", properties: {} } },
    },
    execute: async () => "ok",
    waitMs: 2000,
  });
  const read = onDemandLines(host, [
    builtin("threads_list", "List Threads. Returns rows."),
    builtin("terminal_list", "List terminals. Returns rows."),
  ]);

  expect(read()).toEqual({
    tools: [
      { name: "threads_list", summary: "List Threads." },
      { name: "terminal_list", summary: "List terminals." },
      { name: "echo_args", summary: "Echo arguments." },
    ],
    skills: [
      { name: "hello", description: "Say hello." },
      { name: "read", description: "Read a page." },
    ],
  });
});
