/** The enabled plugins' tools with their summaries and skills with their descriptions, for the per-turn lines. */

import type { PluginHostSnapshot, PluginHostTool } from "./mcp-host";

/** The meta key a plugin tool carries its own one-line summary under. */
const SUMMARY_META = "io.github.yw0nam.yui/summary";
const SUMMARY_MAX = 100;

export interface PluginCatalog {
  tools: Array<{ name: string; summary: string }>;
  skills: Array<{ name: string; description: string }>;
}

/** The tool's summary: its own meta summary, else the first sentence of its description. */
function summaryOf(tool: PluginHostTool): string {
  const meta = tool.meta?.[SUMMARY_META];
  if (typeof meta === "string" && meta.trim() !== "") return meta.trim().slice(0, SUMMARY_MAX);
  const paragraph = (tool.description ?? "").split(/\n\s*\n/)[0] ?? "";
  const collapsed = paragraph.replace(/\s+/g, " ").trim();
  const sentence = /^.*?[.!?](?=\s|$)/.exec(collapsed)?.[0] ?? collapsed;
  return sentence.slice(0, SUMMARY_MAX);
}

/** The enabled plugins' tools and skills, in snapshot order. */
export function pluginCatalog(snapshot: PluginHostSnapshot | null): PluginCatalog {
  const plugins = snapshot?.plugins.filter((plugin) => plugin.enabled) ?? [];
  return {
    tools: plugins.flatMap((plugin) =>
      plugin.tools.map((tool) => ({ name: tool.name, summary: summaryOf(tool) })),
    ),
    skills: plugins.flatMap((plugin) =>
      plugin.skills.map((skill) => ({ name: skill.name, description: skill.description })),
    ),
  };
}

/** The declared tool of an enabled plugin with this exact name; undefined when none. */
export function findPluginTool(
  snapshot: PluginHostSnapshot | null,
  name: string,
): PluginHostTool | undefined {
  return snapshot?.plugins
    .filter((plugin) => plugin.enabled)
    .flatMap((plugin) => plugin.tools)
    .find((tool) => tool.name === name);
}
