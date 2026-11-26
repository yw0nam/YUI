/** yui.plugins: the enabled plugins' tools and skills. */

import { findPluginTool, pluginLines } from "../../../mcp-host/enabled-plugins";
import type { McpHost } from "../../../mcp-host/mcp-host";
import { oneLine } from "../../one-line";
import { firstViolation } from "../bridge/first-violation";
import { pluginToolResult } from "../bridge/plugin-result";
import { TURN_STOPPED } from "../client-tools";
import type { PluginsNamespace, YuiMethod } from "../run/namespace";

const PLUGINS_DECLARATION = `  plugins: {
    /** The enabled plugins' tools. */
    list(): Promise<{ name: string; summary: string }[]>;
    /** The tool's description and JSON input schema, or "error: unknown tool: <name>". */
    describe(name: string): Promise<{ description: string; input_schema: object } | \`error: \${string}\`>;
    /** Runs the tool; args that break its input schema throw. A failure is text starting with "error:". */
    call(name: string, args?: object): Promise<{ text: string; images: ImageHandle[] }>;
  };`;

/** One tool or skill as a `name — text` entry; the name alone when the text is empty. */
function listEntry(name: string, text: string): string {
  const label = oneLine(name);
  const detail = oneLine(text);
  return detail === "" ? label : `${label} — ${detail}`;
}

const failure = (error: unknown): string =>
  `error: ${error instanceof Error ? error.message : String(error)}`;

function nameOf(method: string, name: unknown): string {
  if (typeof name !== "string") throw new TypeError(`yui.plugins.${method}: name must be a string`);
  return name;
}

export function createPluginsApi({
  host,
  presetId,
}: {
  host: McpHost;
  presetId: () => string;
}): PluginsNamespace {
  const list: YuiMethod = async () => pluginLines(host.snapshot()).tools;

  const describe: YuiMethod = async (_signal, name) => {
    const tool = findPluginTool(host.snapshot(), nameOf("describe", name));
    if (!tool) return `error: unknown tool: ${name}`;
    return { description: tool.description ?? "", input_schema: tool.inputSchema };
  };

  const call: YuiMethod = async (signal, name, args) => {
    const toolName = nameOf("call", name);
    // The sandbox hands an omitted argument over as null.
    const toolArgs = args ?? {};
    if (typeof toolArgs !== "object" || Array.isArray(toolArgs))
      throw new TypeError("yui.plugins.call: args must be an object");
    const tool = findPluginTool(host.snapshot(), toolName);
    if (!tool) return { text: `error: unknown tool: ${toolName}`, images: [] };
    const bad = firstViolation(tool.inputSchema, toolArgs);
    if (bad)
      throw new TypeError(
        `yui.plugins.call: invalid arguments (${bad})\ninput schema: ${JSON.stringify(tool.inputSchema)}`,
      );
    if (signal.aborted) return { text: TURN_STOPPED, images: [] };
    const callId = crypto.randomUUID();
    const onAbort = (): void => {
      void host.cancel(callId).catch(() => {});
    };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      const result = pluginToolResult(await host.call(callId, toolName, toolArgs, presetId()));
      return typeof result === "string" ? { text: result, images: [] } : result;
    } catch (error) {
      return { text: failure(error), images: [] };
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  };

  return {
    methods: { list, describe, call },
    declaration: PLUGINS_DECLARATION,
    skill: (name: string): Promise<string> => host.skill(name).catch(failure),
    listing: (): string => {
      const lines = pluginLines(host.snapshot());
      const sentence = (lead: string, entries: string[]) => {
        if (entries.length === 0) return "";
        const text = `${lead}: ${entries.join(" · ")}`;
        return /[.!?]$/.test(text) ? text : `${text}.`;
      };
      return [
        sentence(
          "Plugin tools, run with yui.plugins.call",
          lines.tools.map((tool) => listEntry(tool.name, tool.summary)),
        ),
        sentence(
          'Plugin skills, read with help("plugin:<name>")',
          lines.skills.map((skill) => listEntry(skill.name, skill.description)),
        ),
      ]
        .filter(Boolean)
        .join(" ");
    },
  };
}
