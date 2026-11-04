/** Built-in summaries precede the enabled plugins in each turn's context. */

import { type PluginLines, pluginLines, sentenceSummary } from "../../../mcp-host/enabled-plugins";
import type { McpHost } from "../../../mcp-host/mcp-host";
import type { ClientTool } from "../client-tools";

export function onDemandLines(host: McpHost, tools: readonly ClientTool[]): () => PluginLines {
  const builtins = tools.map((tool) => ({
    name: tool.name,
    summary: sentenceSummary(tool.definition.function.description),
  }));
  return () => {
    const lines = pluginLines(host.snapshot());
    return { tools: [...builtins, ...lines.tools], skills: lines.skills };
  };
}
