/** The one bounded execute the request transports' runClientCall and the push consumer both call. */

import { createLogger } from "../../../logger";
import { type ClientTool, type ClientToolResult, toolFailed, toolResultText } from "./client-tools";

const log = createLogger("execute");

/**
 * Runs the call bounded by the tool's own wait. A wait that passes resolves the tool's timeout
 * result, or an error string naming the seconds; the underlying execution keeps running. The
 * execution's signal aborts when the wait passes or the caller's signal aborts.
 */
export async function executeClientTool(
  tool: ClientTool,
  args: Record<string, unknown>,
  signal?: AbortSignal,
  callId?: string,
  turnId?: string,
): Promise<ClientToolResult> {
  const started = Date.now();
  const result = await boundedExecute(tool, args, signal, turnId);
  const text = toolResultText(result);
  const ok = !toolFailed(tool, result);
  log.info("tool_result", {
    name: tool.name,
    call_id: callId,
    ok,
    duration_ms: Date.now() - started,
    kind: ok ? textKind(text) : "error",
    size: text.length,
  });
  return result;
}

async function boundedExecute(
  tool: ClientTool,
  args: Record<string, unknown>,
  signal: AbortSignal | undefined,
  turnId: string | undefined,
): Promise<ClientToolResult> {
  const execution = new AbortController();
  const abort = (): void => execution.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      tool.execute(args, execution.signal, { turnId }),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => {
          // Resolved before the abort, so a tool's answer to the abort never wins the race.
          resolve(timeoutResult(tool, args));
          abort();
        }, tool.waitMs);
      }),
    ]);
  } catch (err) {
    // The model owns what a failed tool means — hand it the failure rather than dropping the turn.
    return `error: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

function textKind(text: string): "json" | "text" {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null ? "json" : "text";
  } catch {
    return "text";
  }
}

function timeoutResult(tool: ClientTool, args: Record<string, unknown>): string {
  return tool.timeoutResult?.(args) ?? `error: timed out after ${Math.round(tool.waitMs / 1000)} s`;
}
