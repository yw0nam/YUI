/**
 * tool-calls — the push transport's consumer for `tool_call` frames.
 *
 * It refuses what the client cannot run (an undeclared name, a turn the user stopped), drops
 * duplicates, and runs the rest one at a time in arrival order, each answered with a
 * `tool_result` on the same id and turn id. The status pill takes its tool state from the
 * backend's `tool_status` frames; this consumer emits none of its own.
 */

import type { Logger } from "../../../logger";
import type { ClientTool, ClientToolRegistry } from "../tools/client-tools";
import type { ToolCallFrame, ToolResultFrame } from "./push-frames";

export interface PushToolCalls {
  /** Takes one frame from the socket; answers it at once, queues it, or drops it. */
  handle(frame: ToolCallFrame): void;
}

export interface PushToolCallsDeps {
  /** The tools the client declared on this connection; a call for any other name is refused. */
  tools: ClientToolRegistry;
  /** Whether the named turn is one the user stopped. */
  isTurnStopped(turnId: string): boolean;
  /** The result sink; false when the frame could not go out. */
  send(frame: ToolResultFrame): boolean;
  /** The bounded execute shared with the request transports. */
  execute(tool: ClientTool, args: Record<string, unknown>): Promise<string>;
  log: Logger;
}

export function createPushToolCalls(deps: PushToolCallsDeps): PushToolCalls {
  /** Ids queued or running — the set a duplicate id is checked against. */
  const held = new Set<string>();
  let tail: Promise<void> = Promise.resolve();

  function answer(frame: ToolCallFrame, result: string): void {
    if (deps.send({ type: "tool_result", id: frame.id, turn_id: frame.turn_id, result })) return;
    deps.log.warn("tool_result_send_failed", { id: frame.id, name: frame.name });
  }

  async function run(frame: ToolCallFrame, tool: ClientTool): Promise<void> {
    try {
      // A turn the user stopped while this call waited in the queue still refuses.
      if (deps.isTurnStopped(frame.turn_id)) {
        answer(frame, "error: turn stopped");
        return;
      }
      answer(frame, await deps.execute(tool, frame.arguments));
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
      held.add(frame.id);
      tail = tail.then(() => run(frame, tool));
    },
  };
}
