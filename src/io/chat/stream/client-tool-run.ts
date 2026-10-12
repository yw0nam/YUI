/**
 * Running a model's tool call on the client — the one owner both request transports use.
 * A transport maps its wire onto these calls and encodes the results back; what a call does and
 * when its results go back to the model is decided here.
 */

import type { ExpressArgs } from "../../../contract";
import type { ChatStreamEvent } from "./chat-client";
import type { ClientToolRegistry } from "./client-tools";
import { isExpressTool, parseToolArgs } from "./stream-helpers";

/** Whether the client acts on this call: an express cue to play, or a registered tool to run. */
export function ownsCall(tools: ClientToolRegistry | undefined, name: string): boolean {
  return isExpressTool(name) || tools?.get(name) !== undefined;
}

export interface ClientCallOutcome {
  /** The express cue the call played. */
  cue?: ExpressArgs;
  /** Set when a registered tool ran: its result and whether the model needs it back. */
  run?: { result: string; oneWay: boolean };
}

/**
 * Parses the call's arguments, plays its express cue on arrival (cue timing never waits for a
 * round trip), and runs the registered tool with a chip for as long as it runs. Returns undefined
 * for a call the client does not own or whose arguments do not parse (an error event is yielded).
 */
export async function* runClientCall(
  tools: ClientToolRegistry | undefined,
  name: string,
  argsJson: string,
): AsyncGenerator<ChatStreamEvent, ClientCallOutcome | undefined> {
  const tool = tools?.get(name);
  const express_call = isExpressTool(name);
  if (!tool && !express_call) return undefined;

  const parsed = parseToolArgs(argsJson);
  if ("error" in parsed) {
    yield { type: "error", message: `${name} arguments JSON parse failed: ${parsed.error}` };
    return undefined;
  }

  const outcome: ClientCallOutcome = {};
  if (express_call) {
    outcome.cue = parsed.args as ExpressArgs;
    yield { type: "express", args: outcome.cue };
  }
  if (!tool) return outcome;

  if (!express_call) yield { type: "tool_status", status: { state: "running", tool_id: name } };
  let result: string;
  try {
    result = await tool.execute(parsed.args);
  } catch (err) {
    // The model owns what a failed tool means — hand it the failure rather than dropping the turn.
    result = `error: ${err instanceof Error ? err.message : String(err)}`;
  }
  if (!express_call) yield { type: "tool_status", status: { state: "done", tool_id: name } };
  outcome.run = { result, oneWay: tool.oneWay === true };
  return outcome;
}

/**
 * Whether the executed calls are answered back. A tool that answers a question always is; cue-only
 * calls only when the model stopped to wait for them — a response that already spoke would
 * otherwise be asked to speak it all over again.
 */
export function shouldAnswer(
  executed: ReadonlyArray<{ oneWay: boolean }>,
  modelWaited: boolean,
): boolean {
  return executed.length > 0 && (executed.some((e) => !e.oneWay) || modelWaited);
}
