/** The bridge tools: plugin_describe, plugin_call and plugin_skill over the MCP host. */

import { findPluginTool } from "../../../mcp-host/enabled-plugins";
import type { McpHost } from "../../../mcp-host/mcp-host";
import { type ClientTool, TURN_STOPPED } from "../client-tools";
import { firstViolation } from "./first-violation";
import { pluginToolResult } from "./plugin-result";

export function createPluginBridgeTools(deps: {
  host: McpHost;
  /** The preset of the calling window, sent with each call. */
  presetId: () => string;
}): ClientTool[] {
  const host = deps.host;

  const describe: ClientTool = {
    name: "plugin_describe",
    definition: {
      type: "function" as const,
      function: {
        name: "plugin_describe",
        description: "Describe a plugin tool: returns its full description and JSON input schema.",
        parameters: {
          type: "object" as const,
          properties: {
            name: { type: "string", description: "The plugin tool's name." },
          },
          additionalProperties: false as const,
          required: ["name"],
        },
      },
    },
    execute: async (args) => {
      const name = String(args.name ?? "");
      const tool = findPluginTool(host.snapshot(), name);
      if (!tool) return `error: unknown plugin tool: ${name}`;
      return `name: ${tool.name}\ndescription: ${tool.description ?? ""}\ninput schema: ${JSON.stringify(tool.inputSchema)}`;
    },
    waitMs: 2000,
  };

  const call: ClientTool = {
    name: "plugin_call",
    definition: {
      type: "function" as const,
      function: {
        name: "plugin_call",
        description: "Call a plugin tool by name with its arguments.",
        parameters: {
          type: "object" as const,
          properties: {
            name: { type: "string", description: "The plugin tool's name." },
            arguments: { type: "object", description: "The tool's arguments." },
          },
          additionalProperties: false as const,
          required: ["name", "arguments"],
        },
      },
    },
    execute: async (args, signal) => {
      if (signal?.aborted) return TURN_STOPPED;
      const name = String(args.name ?? "");
      const tool = findPluginTool(host.snapshot(), name);
      if (!tool) return `error: unknown plugin tool: ${name}`;
      const toolArgs = args.arguments ?? {};
      const bad = firstViolation(tool.inputSchema, toolArgs);
      if (bad)
        return `error: invalid arguments (${bad})\ninput schema: ${JSON.stringify(tool.inputSchema)}`;
      const callId = crypto.randomUUID();
      const onAbort = (): void => {
        void host.cancel(callId).catch(() => {});
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        return pluginToolResult(await host.call(callId, name, toolArgs, deps.presetId()));
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
    },
    // The host ends a call at 120 s (MAX_WAIT_MS in src-tauri/src/mcp_host/calls.rs); this wait covers it.
    waitMs: 121_000,
    localStatus: true,
    statusId: (args) => String(args.name ?? ""),
    failed: (result) => result.startsWith("error:") || result.startsWith("unknown:"),
  };

  const skill: ClientTool = {
    name: "plugin_skill",
    definition: {
      type: "function" as const,
      function: {
        name: "plugin_skill",
        description: "Read a plugin skill: returns its full instructions.",
        parameters: {
          type: "object" as const,
          properties: {
            name: { type: "string", description: "The plugin skill's name." },
          },
          additionalProperties: false as const,
          required: ["name"],
        },
      },
    },
    execute: (args) => host.skill(String(args.name ?? "")),
    waitMs: 2000,
  };

  return [describe, call, skill];
}
