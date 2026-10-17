/**
 * tool-calls — the push transport's consumer for `tool_call` frames.
 *
 * It refuses what the client cannot run (an undeclared name, a turn the user stopped), drops
 * duplicates, and runs the rest one at a time in arrival order, each answered with a
 * `tool_result` on the same id and turn id. Each held call carries a signal that abort() aborts.
 * The status pill takes its tool state from the backend's `tool_status` frames, except for a tool
 * that shows its own: this consumer reports that tool's running and terminal state by call id.
 */

import type { Logger } from "../../../logger";
import {
  type ClientTool,
  type ClientToolRegistry,
  type ClientToolResult,
  toolFailed,
  toolResultText,
} from "../tools/client-tools";
import type { ToolCallFrame, ToolResultFrame } from "./push-frames";
import { imageToolResult, textToolResult } from "./tool-results/encode";

export interface PushToolCalls {
  /** Takes one frame from the socket; answers it at once, queues it, or drops it. */
  handle(frame: ToolCallFrame): void;
  /** Aborts the signal of every held call of the named turns, or of every held call. */
  abort(turnIds?: readonly string[]): void;
}

export interface PushToolCallsDeps {
  /** The tools the client declared on this connection; a call for any other name is refused. */
  tools: ClientToolRegistry;
  /** Whether the named turn is one the user stopped. */
  isTurnStopped(turnId: string): boolean;
  /** The result sink; false when the frame could not go out. */
  send(frame: ToolResultFrame): boolean;
  /** The bounded execute shared with the request transports. */
  execute(
    tool: ClientTool,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    callId?: string,
  ): Promise<ClientToolResult>;
  getMaxTurnBytes(): number | undefined;
  /** The state of a call whose tool shows its own status, keyed by the call id. */
  onStatus?(
    callId: string,
    state: "running" | "done" | "failed",
    toolId: string,
    action?: string,
  ): void;
  log: Logger;
}

export function createPushToolCalls(deps: PushToolCallsDeps): PushToolCalls {
  /** Calls queued or running by id — the set a duplicate id is checked against. */
  const held = new Map<string, { turnId: string; abort: AbortController }>();
  let tail: Promise<void> = Promise.resolve();

  function send(frame: ToolCallFrame, reply: ToolResultFrame): void {
    if (deps.send(reply)) return;
    deps.log.warn("tool_result_send_failed", { id: frame.id, name: frame.name });
  }

  function answer(frame: ToolCallFrame, result: string): void {
    send(frame, textToolResult(frame, result));
  }

  async function answerResult(frame: ToolCallFrame, result: ClientToolResult): Promise<void> {
    if (typeof result === "string" || result.images.length === 0) {
      answer(frame, toolResultText(result));
      return;
    }
    send(frame, await imageToolResult(frame, result, deps.getMaxTurnBytes()));
  }

  async function run(frame: ToolCallFrame, tool: ClientTool, signal: AbortSignal): Promise<void> {
    try {
      // A turn the user stopped while this call waited in the queue still refuses.
      if (deps.isTurnStopped(frame.turn_id)) {
        answer(frame, "error: turn stopped");
        return;
      }
      const action = tool.localStatus ? tool.statusAction?.(frame.arguments) : undefined;
      if (tool.localStatus) deps.onStatus?.(frame.id, "running", frame.name, action);
      const result = await deps.execute(tool, frame.arguments, signal, frame.id);
      if (tool.localStatus)
        deps.onStatus?.(frame.id, toolFailed(tool, result) ? "failed" : "done", frame.name, action);
      await answerResult(frame, result);
    } finally {
      held.delete(frame.id);
    }
  }

  return {
    handle(frame) {
      const tool = deps.tools.get(frame.name);
      if (tool === undefined) {
        answer(frame, "error: unknown tool");
        return;
      }
      if (held.has(frame.id)) {
        // An answer would resolve the original call's waiter, so the repeat is dropped silently
        // for the backend — a log line is all it gets.
        deps.log.warn("tool_call_duplicate", { id: frame.id, name: frame.name });
        return;
      }
      if (deps.isTurnStopped(frame.turn_id)) {
        answer(frame, "error: turn stopped");
        return;
      }
      const abort = new AbortController();
      held.set(frame.id, { turnId: frame.turn_id, abort });
      // A call that throws is logged so the calls queued behind it still run.
      tail = tail
        .then(() => run(frame, tool, abort.signal))
        .catch((err) =>
          deps.log.warn("tool_call_failed", { id: frame.id, name: frame.name, error: String(err) }),
        );
    },
    abort(turnIds) {
      for (const call of held.values()) {
        if (!turnIds || turnIds.includes(call.turnId)) call.abort.abort();
      }
    },
  };
}
