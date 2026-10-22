/**
 * Client-side tool registry — the tools YUI declares to the backend and runs itself.
 *
 * A tool is {name, definition, execute}. Each transport's wire — the request streams, the push
 * socket's `hello.tools` — declares every definition, looks an incoming call up by name, and
 * hands execute's string back as the tool result — so a new tool is a new registration, never
 * an engine edit.
 */

import type { ClientContext } from "../../../contract";
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
      required?: string[];
    };
  };
}

export type ClientToolResult = string | { text: string; images: string[] };

/** The result of a call whose turn the user stopped. */
export const TURN_STOPPED = "error: turn stopped";

export function toolResultText(result: ClientToolResult): string {
  return typeof result === "string" ? result : result.text;
}

export interface ClientTool {
  name: string;
  definition: ClientToolDefinition;
  /**
   * Runs the call and resolves the text or image result returned to the model. The signal aborts
   * when the wait passes or the turn stops; a tool that ignores it runs on.
   */
  execute(
    args: Record<string, unknown>,
    signal?: AbortSignal,
    call?: { turnId?: string },
  ): Promise<ClientToolResult>;
  /** The wait the call's execution is bounded by; the execution keeps running past it. */
  waitMs: number;
  /** The switch that gates the tool's execution, read when a call runs; absent on unswitched tools. */
  switch?: { id: string; on(): boolean };
  /**
   * Cue-only tool: the result carries nothing the model can use, so a response that already spoke
   * needs no round trip. A tool that answers a question leaves this unset — its result is the point.
   */
  oneWay?: boolean;
  /** The result a wait that passes resolves instead of an error string naming the seconds. */
  timeoutResult?(args: Record<string, unknown>): string;
  /** Whether a result reads as a failure; the status pill shows it as failed. Unset: the result starts with `error:`. */
  failed?(result: string): boolean;
  /** Push shows this tool's status from the client's own run and ignores the backend's `tool_status` naming it. */
  localStatus?: true;
}

/** Whether the result reads as a failure of the tool. */
export function toolFailed(tool: ClientTool, result: ClientToolResult): boolean {
  const text = toolResultText(result);
  return tool.failed ? tool.failed(text) : text.startsWith("error:");
}

export interface ClientToolRegistry {
  /** Declared schemas, in registration order. */
  definitions(): ClientToolDefinition[];
  /** Registered tool by exact name; undefined for a call the client did not declare. */
  get(name: string): ClientTool | undefined;
  /** Switch state of every registered tool that has a switch, in registration order, each read at the call. */
  switches(): NonNullable<ClientContext["tool_switches"]>;
}

export function createClientToolRegistry(tools: readonly ClientTool[]): ClientToolRegistry {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const definitions = tools.map((tool) => tool.definition);
  return {
    definitions: () => definitions,
    get: (name) => byName.get(name),
    switches: () =>
      tools.flatMap((tool) => (tool.switch ? [{ id: tool.switch.id, on: tool.switch.on() }] : [])),
  };
}

/** Every tool a window declares: generate_express, then the window tools it is given. */
export function createClientTools(
  vocab: ExpressVocabulary,
  windowTools: readonly ClientTool[] = [],
): ClientTool[] {
  return [createGenerateExpressTool(vocab), ...windowTools];
}
