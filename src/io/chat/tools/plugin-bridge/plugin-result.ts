/** A plugin tool's MCP result as a client tool result: text blocks joined, images as data URLs, an error marked. */

import type { PluginToolResult } from "../../../mcp-host/mcp-host";
import type { ClientToolResult } from "../client-tools";

/** Whether a result text carries a failure prefix a plugin wrote itself. */
export function isFailureText(text: string): boolean {
  return text.startsWith("error:") || text.startsWith("unknown:");
}

export function pluginToolResult(result: PluginToolResult): ClientToolResult {
  const parts: string[] = [];
  const images: string[] = [];
  for (const block of result.content) {
    if (block.type === "text") parts.push(String(block.text ?? ""));
    else if (block.type === "image")
      images.push(`data:${String(block.mimeType ?? "")};base64,${String(block.data ?? "")}`);
    else parts.push(JSON.stringify(block));
  }
  const joined = parts.join("\n");
  const text = result.isError && !isFailureText(joined) ? `error: ${joined}` : joined;
  return images.length > 0 ? { text, images } : text;
}
