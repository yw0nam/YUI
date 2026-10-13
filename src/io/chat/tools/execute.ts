/** The one bounded execute the request transports' runClientCall and the push consumer both call. */

import type { ClientTool, ClientToolResult } from "./client-tools";

/**
 * Runs the call bounded by the tool's own wait. A wait that passes resolves the tool's timeout
 * result, or an error string naming the seconds; the underlying execution keeps running. The
 * execution's signal aborts when the wait passes or the caller's signal aborts.
 */
export async function executeClientTool(
  tool: ClientTool,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ClientToolResult> {
  const execution = new AbortController();
  const abort = (): void => execution.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      tool.execute(args, execution.signal),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => {
          abort();
          resolve(timeoutResult(tool, args));
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

function timeoutResult(tool: ClientTool, args: Record<string, unknown>): string {
  return tool.timeoutResult?.(args) ?? `error: timed out after ${Math.round(tool.waitMs / 1000)} s`;
}
