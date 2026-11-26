/**
 * plugin-result.test.ts — a plugin tool's MCP result as a client tool result.
 */

import { describe, expect, it } from "vitest";
import type { PluginToolResult } from "../../../mcp-host/mcp-host";
import { pluginToolResult } from "./plugin-result";

describe("pluginToolResult", () => {
  it("joins the text blocks and carries the images as data URLs", () => {
    const result: PluginToolResult = {
      content: [
        { type: "text", text: "first" },
        { type: "image", mimeType: "image/png", data: "QUJD" },
        { type: "text", text: "second" },
      ],
      isError: false,
    };

    expect(pluginToolResult(result)).toEqual({
      text: "first\nsecond",
      images: ["data:image/png;base64,QUJD"],
    });
  });

  it("marks an error result", () => {
    const result: PluginToolResult = { content: [{ type: "text", text: "boom" }], isError: true };

    expect(pluginToolResult(result)).toBe("error: boom");
  });

  it("keeps a plugin error result's own error or unknown prefix", () => {
    const error: PluginToolResult = {
      content: [{ type: "text", text: "error: x" }],
      isError: true,
    };
    const unknown: PluginToolResult = {
      content: [{ type: "text", text: "unknown: x" }],
      isError: true,
    };

    expect(pluginToolResult(error)).toBe("error: x");
    expect(pluginToolResult(unknown)).toBe("unknown: x");
  });

  it("puts a block of another kind in the text as JSON", () => {
    const result: PluginToolResult = {
      content: [{ type: "resource_link", uri: "file:///a" }],
      isError: false,
    };

    expect(pluginToolResult(result)).toBe('{"type":"resource_link","uri":"file:///a"}');
  });
});
