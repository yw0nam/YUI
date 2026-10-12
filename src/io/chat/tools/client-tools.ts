/**
 * Client-side tool registry — the tools YUI declares to the backend and runs itself.
 *
 * A tool is {name, definition, execute}. Each transport's wire — the request streams, the push
 * socket's `hello.tools` — declares every definition, looks an incoming call up by name, and
 * hands execute's string back as the tool result — so a new tool is a new registration, never
 * an engine edit.
 */

import type { ExpressVocabulary } from "../vocabulary/express-vocabulary";
import { createGenerateExpressTool } from "./express";

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
  /**
   * Cue-only tool: the result carries nothing the model can use, so a response that already spoke
   * needs no round trip. A tool that answers a question leaves this unset — its result is the point.
   */
  oneWay?: boolean;
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

/** Every tool the client declares, in declaration order. */
export function createClientTools(vocab: ExpressVocabulary): ClientTool[] {
  return [createGenerateExpressTool(vocab)];
}
