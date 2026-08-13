/**
 * Client-side tool registry — the tools YUI declares on Chat Completions requests and runs itself.
 *
 * A tool is {name, definition, execute}. The engine (chat-client's CC branch) declares every
 * definition on the request, looks an incoming call up by name, and hands execute's string back as
 * the tool result — so a new tool is a new registration, never an engine edit.
 *
 * generate_express is the first registration. Its schema carries the vocabulary the client has
 * loaded (the same ids published to the broker), and its cue plays from the express stream event
 * the engine emits the moment the call arrives, so execute only acknowledges the call.
 */

import type { EmotionRegistry, MotionRegistry } from "../contract";
import { agentTriggerableMotionIds } from "./broker-client";

/** OpenAI function-tool schema. Structural — narrowed to the SDK's type at the request site. */
export interface ClientToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      additionalProperties: false;
    };
  };
}

export interface ClientTool {
  name: string;
  definition: ClientToolDefinition;
  /** Runs the call; resolves the result string returned to the model. */
  execute(args: Record<string, unknown>): Promise<string>;
}

export interface ClientToolRegistry {
  /** Declared schemas, in registration order. */
  definitions(): ClientToolDefinition[];
  /** Registered tool by exact name; undefined for a call the client did not declare. */
  get(name: string): ClientTool | undefined;
}

export function createClientToolRegistry(tools: readonly ClientTool[]): ClientToolRegistry {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const definitions = tools.map((tool) => tool.definition);
  return {
    definitions: () => definitions,
    get: (name) => byName.get(name),
  };
}

/** The cue contract, in the words the model reads before calling. */
const EXPRESS_DESCRIPTION =
  "Place an expression cue on the speech around this call: facial expression, body motion, and " +
  "voice tone. Call it per sentence or expressive beat, at the point where the expression should " +
  "change, and include only the fields that change. Spoken words never go in the arguments.";

/** Vocabulary the express schema enumerates — the loaded registries. */
export interface ExpressVocabulary {
  emotionRegistry: EmotionRegistry;
  motions: MotionRegistry;
}

export function createGenerateExpressTool(vocab: ExpressVocabulary): ClientTool {
  return {
    name: "generate_express",
    definition: {
      type: "function",
      function: {
        name: "generate_express",
        description: EXPRESS_DESCRIPTION,
        parameters: {
          type: "object",
          properties: {
            emotion_id: {
              type: "string",
              description: "facial expression",
              enum: Object.keys(vocab.emotionRegistry),
            },
            motion_id: {
              type: "string",
              description: "body motion",
              enum: agentTriggerableMotionIds(vocab.motions),
            },
            emotion_text: { type: "string", description: "voice tone tag" },
          },
          additionalProperties: false,
        },
      },
    },
    execute: async () => "ok",
  };
}
