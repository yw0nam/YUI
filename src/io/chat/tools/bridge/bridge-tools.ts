/** The bridge tools reach built-in On-demand tools and enabled plugins. */

import { findPluginTool } from "../../../mcp-host/enabled-plugins";
import type { McpHost } from "../../../mcp-host/mcp-host";
import { type ClientTool, TURN_STOPPED } from "../client-tools";
import { executeClientTool } from "../execute";
import { terminalFailed } from "../terminal/terminal-tools";
import { firstViolation } from "./first-violation";
import { isFailureText, pluginToolResult } from "./plugin-result";

export function createBridgeTools(deps: {
  host: McpHost;
  onDemand: readonly ClientTool[];
  /** The preset of the calling window, sent with each call. */
  presetId: () => string;
}): ClientTool[] {
  const host = deps.host;
  const resolve = (name: string) => {
    const builtin = deps.onDemand.find((tool) => tool.name === name);
    if (builtin)
      return {
        description: builtin.definition.function.description,
        schema: builtin.definition.function.parameters,
        builtin,
      };
    const plugin = findPluginTool(host.snapshot(), name);
    if (!plugin) return undefined;
    return {
      description: plugin.description ?? "",
      schema: plugin.inputSchema,
      builtin: undefined,
    };
  };

  const describe: ClientTool = {
    name: "yui_tool_describe",
    definition: {
      type: "function" as const,
      function: {
        name: "yui_tool_describe",
        description:
          "Describe an on-demand tool listed in the client context: returns its full description and JSON input schema.",
        parameters: {
          type: "object" as const,
          properties: {
            name: { type: "string", description: "The on-demand tool's name." },
          },
          additionalProperties: false as const,
          required: ["name"],
        },
      },
    },
    execute: async (args) => {
      const name = String(args.name ?? "");
      const target = resolve(name);
      if (!target) return `error: unknown tool: ${name}`;
      return `name: ${name}\ndescription: ${target.description}\ninput schema: ${JSON.stringify(target.schema)}`;
    },
    waitMs: 2000,
  };

  const call: ClientTool = {
    name: "yui_tool_call",
    definition: {
      type: "function" as const,
      function: {
        name: "yui_tool_call",
        description:
          "Call an on-demand tool listed in the client context by name with its arguments.",
        parameters: {
          type: "object" as const,
          properties: {
            name: { type: "string", description: "The on-demand tool's name." },
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
      const target = resolve(name);
      if (!target) return `error: unknown tool: ${name}`;
      const schema = target.schema;
      const toolArgs = args.arguments ?? {};
      const bad = firstViolation(schema, toolArgs);
      if (bad) return `error: invalid arguments (${bad})\ninput schema: ${JSON.stringify(schema)}`;
      if (target.builtin)
        return executeClientTool(target.builtin, toolArgs as Record<string, unknown>, signal);
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
    failed: (text) => isFailureText(text) || terminalFailed(text),
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
