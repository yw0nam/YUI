/** Runs a script against one yui namespace in the sandbox, for the namespace modules' tests. */

import type { YuiMethod } from "./namespace";
import { type RunResult, runScript } from "./sandbox";

export function runNamespace(
  name: string,
  namespace: Record<string, YuiMethod>,
  code: string,
  signal: AbortSignal = new AbortController().signal,
): Promise<RunResult> {
  const bound = Object.fromEntries(
    Object.entries(namespace).map(([key, method]) => [
      key,
      (...args: unknown[]) => method(signal, ...args),
    ]),
  );
  return runScript(code, { yui: { [name]: bound }, help: async () => "" }, signal);
}
