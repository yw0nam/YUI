/**
 * plugin-catalog.test.ts — the enabled plugins' tools and skills, read for the per-turn lines.
 */

import { describe, expect, it } from "vitest";
import type { PluginHostSnapshot, PluginHostTool } from "./mcp-host";
import { findPluginTool, pluginCatalog } from "./plugin-catalog";

const TOOL = (over: Partial<PluginHostTool> = {}): PluginHostTool => ({
  name: "echo_args",
  server: "p1/s",
  description: null,
  inputSchema: { type: "object" },
  meta: null,
  ...over,
});

const SNAPSHOT = (over: Partial<PluginHostSnapshot> = {}): PluginHostSnapshot => ({
  revision: 1,
  plugins: [],
  ...over,
});

describe("pluginCatalog", () => {
  it("prefers the tool's meta summary over its description", () => {
    const snapshot = SNAPSHOT({
      plugins: [
        {
          id: "p1",
          enabled: true,
          tools: [
            TOOL({
              description: "Echoes the arguments it was given.",
              meta: { "io.github.yw0nam.yui/summary": "Echo argv." },
            }),
          ],
          skills: [],
        },
      ],
    });

    expect(pluginCatalog(snapshot).tools).toEqual([{ name: "echo_args", summary: "Echo argv." }]);
  });

  it("takes the first sentence of the description's first line", () => {
    const snapshot = SNAPSHOT({
      plugins: [
        {
          id: "p1",
          enabled: true,
          tools: [
            TOOL({
              description: "Look up the weather forecast for a city.\nReturns one line per day.",
            }),
          ],
          skills: [],
        },
      ],
    });

    expect(pluginCatalog(snapshot).tools[0]?.summary).toBe(
      "Look up the weather forecast for a city.",
    );
  });

  it("leaves out a disabled plugin's tools and skills", () => {
    const snapshot = SNAPSHOT({
      plugins: [
        {
          id: "p1",
          enabled: true,
          tools: [TOOL()],
          skills: [{ name: "hello", description: "Says hello." }],
        },
        {
          id: "p2",
          enabled: false,
          tools: [TOOL({ name: "hidden_tool" })],
          skills: [{ name: "hidden_skill", description: "Hidden." }],
        },
      ],
    });

    expect(pluginCatalog(snapshot)).toEqual({
      tools: [{ name: "echo_args", summary: "" }],
      skills: [{ name: "hello", description: "Says hello." }],
    });
  });

  it("cuts a long summary to 100 characters", () => {
    const snapshot = SNAPSHOT({
      plugins: [
        {
          id: "p1",
          enabled: true,
          tools: [TOOL({ description: `${"a".repeat(149)}.` })],
          skills: [],
        },
      ],
    });

    expect(pluginCatalog(snapshot).tools[0]?.summary).toBe("a".repeat(100));
  });
});

describe("findPluginTool", () => {
  it("finds an enabled plugin's tool and ignores a disabled one's", () => {
    const snapshot = SNAPSHOT({
      plugins: [
        { id: "p1", enabled: true, tools: [TOOL()], skills: [] },
        { id: "p2", enabled: false, tools: [TOOL({ name: "hidden_tool" })], skills: [] },
      ],
    });

    expect(findPluginTool(snapshot, "echo_args")?.name).toBe("echo_args");
    expect(findPluginTool(snapshot, "hidden_tool")).toBeUndefined();
  });
});
