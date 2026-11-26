/** Runs a script against one yui namespace in the sandbox, for the namespace modules' tests. */

import { type RunResult, runScript } from "./sandbox";

/** A namespace method as its module declares it: the run's signal first, then the script's arguments. */
export type NamespaceMethod = (signal: AbortSignal, ...args: unknown[]) => Promise<unknown>;

export function runNamespace(
  name: string,
  namespace: Record<string, NamespaceMethod>,
  code: string,
  signal: AbortSignal = new AbortController().signal,
): Promise<RunResult> {
  const bound = Object.fromEntries(
    Object.entries(namespace).map(([key, method]) => [
      key,
      (...args: unknown[]) => method(signal, ...args),
    ]),
  );
  return runScript(code, { yui: { [name]: bound }, help: () => "" }, signal);
}
