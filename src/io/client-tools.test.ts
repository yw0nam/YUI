/**
 * client-tools.test.ts — the client-side tool registry and the generate_express tool.
 *
 * The registry is the general engine's data: any tool with {name, definition, execute} plugs in.
 * generate_express is the first registration, and its schema is derived from the loaded emotion /
 * motion vocabulary — never a hardcoded enum.
 */

import { describe, expect, it, vi } from "vitest";
import type { EmotionRegistry, MotionRegistry } from "../contract";
import {
  type ClientTool,
  createClientToolRegistry,
  createGenerateExpressTool,
} from "./client-tools";

function emotionRegistry(): EmotionRegistry {
  return {
    neutral: { vrm_expression: "neutral", fallback: "neutral" },
    happy: { vrm_expression: "happy", fallback: "neutral" },
    sad: { vrm_expression: "sad", fallback: "neutral" },
  } as EmotionRegistry;
}

function motions(): MotionRegistry {
  return {
    idle: {
      vrma_path: "/motions/idle.vrma",
      kind: "ambient",
      loop: true,
      priority: 10,
      interrupt_policy: "ignore",
    },
    drag: {
      vrma_path: "/motions/drag.vrma",
      kind: "reactive",
      loop: false,
      priority: 50,
      interrupt_policy: "replace",
    },
    dance: {
      vrma_path: "/motions/dance.vrma",
      kind: "oneshot",
      loop: false,
      priority: 60,
      interrupt_policy: "replace",
    },
    sit: {
      vrma_path: "/motions/sit.vrma",
      kind: "oneshot",
      loop: false,
      priority: 60,
      interrupt_policy: "replace",
      broker_publish: false,
    },
  };
}

const vocab = () => ({ emotionRegistry: emotionRegistry(), motions: motions() });

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

  it("derives emotion_id's enum from the loaded emotion registry", () => {
    const props = createGenerateExpressTool(vocab()).definition.function.parameters.properties;
    expect(props.emotion_id).toMatchObject({ type: "string", enum: ["neutral", "happy", "sad"] });
  });

  it("derives motion_id's enum from the agent-triggerable motions (no reactive/ambient/unpublished)", () => {
    const props = createGenerateExpressTool(vocab()).definition.function.parameters.properties;
    expect(props.motion_id).toMatchObject({ type: "string", enum: ["dance"] });
  });

  it("leaves emotion_text free text and keeps every field optional", () => {
    const params = createGenerateExpressTool(vocab()).definition.function.parameters;
    expect(params.properties.emotion_text).toMatchObject({ type: "string" });
    expect((params.properties.emotion_text as Record<string, unknown>).enum).toBeUndefined();
    expect(params.type).toBe("object");
    expect(params.additionalProperties).toBe(false);
    expect("required" in params).toBe(false);
  });

  it("reflects a changed vocabulary — an added emotion and motion land in the enums", () => {
    const next = vocab();
    next.emotionRegistry.angry = { vrm_expression: "angry", fallback: "neutral" };
    next.motions.wave = {
      vrma_path: "/motions/wave.vrma",
      kind: "oneshot",
      loop: false,
      priority: 60,
      interrupt_policy: "replace",
    };
    const props = createGenerateExpressTool(next).definition.function.parameters.properties;
    expect(props.emotion_id).toMatchObject({ enum: ["neutral", "happy", "sad", "angry"] });
    expect(props.motion_id).toMatchObject({ enum: ["dance", "wave"] });
  });

  it("resolves execute to ok", async () => {
    await expect(createGenerateExpressTool(vocab()).execute({ emotion_id: "happy" })).resolves.toBe(
      "ok",
    );
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
