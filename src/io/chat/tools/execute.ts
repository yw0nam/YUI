/** The one bounded execute the request transports' runClientCall and the push consumer both call. */

import type { ClientTool, ClientToolResult } from "./client-tools";

/**
 * Runs the call bounded by the tool's own wait. A wait that passes resolves the tool's timeout
 * word, or an error string naming the seconds; the underlying execution keeps running.
 */
export async function executeClientTool(
  tool: ClientTool,
  args: Record<string, unknown>,
): Promise<ClientToolResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      tool.execute(args),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve(timeoutResult(tool)), tool.waitMs);
      }),
    ]);
  } catch (err) {
    // The model owns what a failed tool means — hand it the failure rather than dropping the turn.
    return `error: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    clearTimeout(timer);
  }
}

function timeoutResult(tool: ClientTool): string {
  return tool.timeoutResult === "timeout"
    ? "timeout"
    : `error: timed out after ${Math.round(tool.waitMs / 1000)} s`;
}
