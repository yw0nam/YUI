/**
 * client-tools.test.ts — the client-side tool registry and the generate_express tool.
 *
 * The registry is the general engine's data: any tool with {name, definition, execute} plugs in.
 * generate_express is the first registration, and its schema is derived from the loaded emotion /
 * motion vocabulary — never a hardcoded enum.
 */

import { describe, expect, it, vi } from "vitest";
import type { BrokerPayload } from "./broker-client";
import {
  type ClientTool,
  createClientToolRegistry,
  createGenerateExpressTool,
} from "./client-tools";

/** The published vocabulary (broker-client.deriveBrokerPayload) is the schema's only source. */
const vocab = (over: Partial<BrokerPayload> = {}): BrokerPayload => ({
  emotionIds: ["neutral", "happy", "sad"],
  motionIds: ["dance", "calm"],
  emotionText: { mode: "free", table: null },
  ...over,
});

// ─────────────────────────────────────────────────────────────────────────────
// generate_express definition
// ─────────────────────────────────────────────────────────────────────────────

describe("createGenerateExpressTool — definition", () => {
  it("is a function tool named generate_express", () => {
    const tool = createGenerateExpressTool(vocab());
    expect(tool.name).toBe("generate_express");
    expect(tool.definition.type).toBe("function");
    expect(tool.definition.function.name).toBe("generate_express");
    expect(tool.definition.function.description.length).toBeGreaterThan(0);
  });

  it("derives the emotion_id and motion_id enums from the published vocabulary", () => {
    const props = createGenerateExpressTool(vocab()).definition.function.parameters.properties;
    expect(props.emotion_id).toMatchObject({ type: "string", enum: ["neutral", "happy", "sad"] });
    expect(props.motion_id).toMatchObject({ type: "string", enum: ["dance", "calm"] });
  });

  it("keeps every field optional and refuses extra properties", () => {
    const params = createGenerateExpressTool(vocab()).definition.function.parameters;
    expect(params.type).toBe("object");
    expect(params.additionalProperties).toBe(false);
    expect("required" in params).toBe(false);
  });

  it("free-mode emotion_text is plain text", () => {
    const props = createGenerateExpressTool(vocab()).definition.function.parameters.properties;
    expect(props.emotion_text).toMatchObject({ type: "string" });
    expect((props.emotion_text as Record<string, unknown>).enum).toBeUndefined();
  });

  it("enum-mode emotion_text enumerates the provider's tags and carries their meanings", () => {
    const tool = createGenerateExpressTool(
      vocab({ emotionText: { mode: "enum", table: { "👂": "Whisper", "🤭": "Giggle" } } }),
    );
    const emotionText = tool.definition.function.parameters.properties.emotion_text as Record<
      string,
      unknown
    >;
    expect(emotionText.enum).toEqual(["👂", "🤭"]);
    expect(emotionText.description).toContain("👂 = Whisper");
    expect(emotionText.description).toContain("🤭 = Giggle");
  });

  it("declares caption as free text, with no enum and no vocabulary tie", () => {
    const props = createGenerateExpressTool(
      vocab({ emotionText: { mode: "enum", table: { "👂": "Whisper" } } }),
    ).definition.function.parameters.properties;
    const caption = props.caption as Record<string, unknown>;
    expect(caption).toMatchObject({ type: "string" });
    expect(caption.enum).toBeUndefined();
  });

  it("caption's description says it is a voice direction that may be omitted", () => {
    const caption = createGenerateExpressTool(vocab()).definition.function.parameters.properties
      .caption as Record<string, unknown>;
    const description = String(caption.description);
    expect(description).toMatch(/voice direction/i);
    expect(description).toMatch(/omit/i);
  });

  it("enum mode with no table falls back to free text", () => {
    const tool = createGenerateExpressTool(vocab({ emotionText: { mode: "enum", table: null } }));
    const props = tool.definition.function.parameters.properties;
    expect((props.emotion_text as Record<string, unknown>).enum).toBeUndefined();
  });

  it("reflects a changed vocabulary — an added emotion and motion land in the enums", () => {
    const props = createGenerateExpressTool(
      vocab({ emotionIds: ["neutral", "angry"], motionIds: ["dance", "wave"] }),
    ).definition.function.parameters.properties;
    expect(props.emotion_id).toMatchObject({ enum: ["neutral", "angry"] });
    expect(props.motion_id).toMatchObject({ enum: ["dance", "wave"] });
  });

  // An empty enum is not a legal narrowing — some providers reject it, and the ones that accept it
  // leave the model a parameter it can never fill. The property goes away instead.
  it("omits motion_id entirely when the curated motion vocabulary is empty", () => {
    const params = createGenerateExpressTool(vocab({ motionIds: [] })).definition.function
      .parameters;
    expect("motion_id" in params.properties).toBe(false);
    expect(Object.keys(params.properties)).toEqual(["emotion_id", "emotion_text", "caption"]);
  });

  it("drops body motion from the description when motion_id is omitted", () => {
    const withMotion = createGenerateExpressTool(vocab()).definition.function.description;
    const without = createGenerateExpressTool(vocab({ motionIds: [] })).definition.function
      .description;
    expect(withMotion).toContain("body motion");
    expect(without).not.toContain("body motion");
    expect(without).toContain("voice tone");
  });

  it("resolves execute to ok and is one-way — its result tells the model nothing", async () => {
    const tool = createGenerateExpressTool(vocab());
    await expect(tool.execute({ emotion_id: "happy" })).resolves.toBe("ok");
    expect(tool.oneWay).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// registry
// ─────────────────────────────────────────────────────────────────────────────

const dummyTool = (name: string, result = "done"): ClientTool => ({
  name,
  definition: {
    type: "function",
    function: {
      name,
      description: `dummy ${name}`,
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  execute: vi.fn(async () => result),
});

describe("createClientToolRegistry", () => {
  it("publishes every registered definition in registration order", () => {
    const registry = createClientToolRegistry([
      createGenerateExpressTool(vocab()),
      dummyTool("get_weather"),
    ]);
    expect(registry.definitions().map((d) => d.function.name)).toEqual([
      "generate_express",
      "get_weather",
    ]);
  });

  it("looks a tool up by its exact name", () => {
    const weather = dummyTool("get_weather");
    const registry = createClientToolRegistry([createGenerateExpressTool(vocab()), weather]);
    expect(registry.get("get_weather")).toBe(weather);
    expect(registry.get("generate_express")?.name).toBe("generate_express");
  });

  it("returns undefined for a name the client did not register", () => {
    const registry = createClientToolRegistry([createGenerateExpressTool(vocab())]);
    expect(registry.get("mcp_hermes_generate_express")).toBeUndefined();
  });

  it("declares nothing when empty", () => {
    expect(createClientToolRegistry([]).definitions()).toEqual([]);
  });
});
