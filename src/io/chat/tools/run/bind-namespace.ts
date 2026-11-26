/** One namespace as a run's sandbox sees it: each call names the status pill, gets the run's signal, and hands its images over as handles. */

import { isPlainObject } from "../../../../settings/persisted-store";
import type { YuiNamespace } from "./namespace";
import type { HostApi } from "./sandbox";

/** The namespaces whose calls name the status pill. */
const REPORTED = new Set<string>(["look", "threads", "terminal"]);

/** The id a call shows on the pill: its namespace, a plugin call's tool name, or none. */
function statusOf(name: string, method: string, args: unknown[]): string | undefined {
  if (REPORTED.has(name)) return name;
  if (name === "plugins" && method === "call" && typeof args[0] === "string") return args[0];
  return undefined;
}

export function bindNamespace(
  name: string,
  namespace: YuiNamespace,
  run: {
    signal: AbortSignal;
    status?: (id: string) => void;
    /** Takes a call's images and returns the handles that stand in for them. */
    keep: (images: string[]) => unknown[];
  },
): HostApi {
  return Object.fromEntries(
    Object.entries(namespace.methods).map(([method, fn]) => [
      method,
      async (...args: unknown[]) => {
        const id = statusOf(name, method, args);
        if (id !== undefined) run.status?.(id);
        const result = await fn(run.signal, ...args);
        const made = isPlainObject(result) && (result as { images?: unknown }).images;
        return Array.isArray(made) && made.every((url) => typeof url === "string")
          ? { ...(result as object), images: run.keep(made) }
          : result;
      },
    ]),
  );
}
