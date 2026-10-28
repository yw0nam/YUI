/**
 * PROTOTYPE (#1661, throwaway, branch prototype/bridge-tools): the two plugin bridge tools over an
 * in-memory fake catalog, and the `plugin tools:` client-context line. Wording "A" or "B" is read
 * from localStorage `yui.proto-bridge-wording` at each use (default "A"). Not production code.
 */

import type { ClientTool, ClientToolResult } from "../client-tools";

type Schema = Record<string, unknown>;

interface FakeTool {
  name: string;
  /** MCP-style description; its first line is the summary on the `plugin tools:` line. */
  description: string;
  inputSchema: Schema;
  run(args: Record<string, unknown>): ClientToolResult;
}

// 64x64: orange left half, green right half, a black disc in the centre. The text result never
// says so, so a reply that names these colours saw the image.
const CARD_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAf0lEQVR42u3Y2w3AIAwDQPZXh+imdISKlxKiszwA90fc+tOOtr2HCwAAAAAAAAAAAAAAAFAG8J+0gLFkA8wkD2A+GQCriQXsSRRgZwBCX79iAAAAAAAAALgS4DOXAHD9PVDhIqtwE1dYJSrsQhWWOeMuAAAAAAAAAAAAAADASD8dKdES0oZwUgAAAABJRU5ErkJggg==";

const CATALOG: FakeTool[] = [
  {
    name: "weather_lookup",
    description:
      "Look up the weather forecast for a city.\nReturns one line per day: condition, high and low temperature.",
    inputSchema: {
      type: "object",
      properties: {
        location: {
          type: "object",
          properties: {
            city: { type: "string", description: "City name, e.g. Seoul." },
            country: { type: "string", description: "Optional country name or ISO code." },
          },
          required: ["city"],
          additionalProperties: false,
        },
        units: { type: "string", enum: ["metric", "imperial"] },
        days: { type: "integer", minimum: 1, maximum: 7, description: "Number of days, 1 to 7." },
      },
      required: ["location", "units", "days"],
      additionalProperties: false,
    },
    run(args) {
      const loc = args.location as { city: string; country?: string };
      const metric = args.units === "metric";
      const days = args.days as number;
      const conditions = ["sunny", "cloudy", "light rain", "clear", "windy", "showers", "overcast"];
      const lines = Array.from({ length: days }, (_, i) => {
        const hi = metric ? 14 + i : 57 + 2 * i;
        const lo = metric ? 5 + i : 41 + 2 * i;
        const u = metric ? "°C" : "°F";
        return `day ${i + 1}: ${conditions[i]}, high ${hi}${u}, low ${lo}${u}`;
      });
      return `forecast for ${loc.city}${loc.country ? `, ${loc.country}` : ""}:\n${lines.join("\n")}`;
    },
  },
  {
    name: "snapshot_card",
    description: "Render a snapshot card image.\nTakes no arguments and returns the card as an image.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: () => ({ text: "snapshot card rendered; the image is attached.", images: [CARD_PNG] }),
  },
];

const byName = new Map(CATALOG.map((tool) => [tool.name, tool]));

/** The few JSON Schema keywords the fake catalog uses; returns the first violation's path, or null. */
function violation(schema: Schema, value: unknown, path: string): string | null {
  switch (schema.type) {
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value))
        return `${path} must be an object`;
      const obj = value as Record<string, unknown>;
      const props = (schema.properties ?? {}) as Record<string, Schema>;
      for (const key of (schema.required ?? []) as string[])
        if (!(key in obj)) return `${path}.${key} is required`;
      for (const [key, v] of Object.entries(obj)) {
        const sub = props[key];
        if (!sub) {
          if (schema.additionalProperties === false) return `${path}.${key} is not allowed`;
          continue;
        }
        const bad = violation(sub, v, `${path}.${key}`);
        if (bad) return bad;
      }
      return null;
    }
    case "string":
      if (typeof value !== "string") return `${path} must be a string`;
      if (Array.isArray(schema.enum) && !schema.enum.includes(value))
        return `${path} must be one of ${schema.enum.join(", ")}`;
      return null;
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) return `${path} must be an integer`;
      if (typeof schema.minimum === "number" && value < schema.minimum)
        return `${path} must be >= ${schema.minimum}`;
      if (typeof schema.maximum === "number" && value > schema.maximum)
        return `${path} must be <= ${schema.maximum}`;
      return null;
    default:
      return null;
  }
}

function wording(): "A" | "B" {
  try {
    return JSON.parse(localStorage.getItem("yui.proto-bridge-wording") ?? '"A"') === "B" ? "B" : "A";
  } catch {
    return "A";
  }
}

const summary = (tool: FakeTool): string => (tool.description.split("\n")[0] ?? "").slice(0, 120);

/** The per-turn client-context line naming each enabled plugin tool. */
export function pluginToolsLine(): string {
  const entries = CATALOG.map((tool) => `${tool.name} — ${summary(tool)}`).join(" · ");
  return wording() === "B"
    ? `plugin tools (run through plugin_call; read a tool's argument schema with plugin_describe first): ${entries}`
    : `plugin tools: ${entries}`;
}

const DESCRIPTIONS = {
  A: {
    describe: "Describe a plugin tool: returns its full description and JSON input schema.",
    call: "Call a plugin tool by name with its arguments.",
    callArgs: "The tool's arguments.",
  },
  B: {
    describe:
      "Return the full description and the JSON Schema of the arguments of one plugin tool named on the `plugin tools:` line of the client context. Call this before your first plugin_call to that tool.",
    call: "Run one plugin tool named on the `plugin tools:` line of the client context. `arguments` must match the schema that plugin_describe returns for that tool. Invalid arguments return `error: invalid arguments` and the schema; correct them and call again.",
    callArgs: "An object that matches the tool's argument schema from plugin_describe.",
  },
};

const unknownTool = (name: unknown): string =>
  `error: unknown plugin tool ${JSON.stringify(name)}; known: ${CATALOG.map((t) => t.name).join(", ")}`;

function schemaText(tool: FakeTool): string {
  return JSON.stringify(tool.inputSchema);
}

export function createPluginBridgeTools(): ClientTool[] {
  const describe: ClientTool = {
    name: "plugin_describe",
    get definition() {
      return {
        type: "function" as const,
        function: {
          name: "plugin_describe",
          description: DESCRIPTIONS[wording()].describe,
          parameters: {
            type: "object" as const,
            properties: { name: { type: "string", description: "The plugin tool's name." } },
            required: ["name"],
            additionalProperties: false as const,
          },
        },
      };
    },
    waitMs: 2000,
    async execute(args) {
      const tool = byName.get(String(args.name));
      if (!tool) return unknownTool(args.name);
      return `name: ${tool.name}\ndescription: ${tool.description}\ninput schema: ${schemaText(tool)}`;
    },
  };
  const call: ClientTool = {
    name: "plugin_call",
    get definition() {
      const d = DESCRIPTIONS[wording()];
      return {
        type: "function" as const,
        function: {
          name: "plugin_call",
          description: d.call,
          parameters: {
            type: "object" as const,
            properties: {
              name: { type: "string", description: "The plugin tool's name." },
              arguments: { type: "object", description: d.callArgs },
            },
            required: ["name", "arguments"],
            additionalProperties: false as const,
          },
        },
      };
    },
    waitMs: 2000,
    async execute(args) {
      const tool = byName.get(String(args.name));
      if (!tool) return unknownTool(args.name);
      // A model may send the arguments as a JSON string; accept that shape too.
      let toolArgs: unknown = args.arguments ?? {};
      if (typeof toolArgs === "string") {
        try {
          toolArgs = JSON.parse(toolArgs);
        } catch {
          /* left as the string; the check below rejects it */
        }
      }
      const bad = violation(tool.inputSchema, toolArgs, "arguments");
      if (bad) return `error: invalid arguments (${bad})\ninput schema: ${schemaText(tool)}`;
      return tool.run(toolArgs as Record<string, unknown>);
    },
  };
  return [describe, call];
}
