import { vi } from "vitest";

type Options = { ifAvailable?: boolean; signal?: AbortSignal };

/**
 * One exclusive lock: `ifAvailable` answers null while held; a queued request is granted in order and honours `signal`.
 * `grantAfterAbort` models a grant already scheduled when the abort lands, so the callback still runs.
 */
export function fakeLocks(opts: { heldByOther?: boolean; grantAfterAbort?: boolean } = {}) {
  let held = opts.heldByOther ?? false;
  const waiting: Array<() => void> = [];
  const next = () => {
    held = false;
    waiting.shift()?.();
  };
  const request = vi.fn(
    (
      _name: string,
      options: Options,
      callback: (lock: object | null) => Promise<void> | undefined,
    ) =>
      new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          waiting.splice(waiting.indexOf(grant), 1);
          reject(new DOMException("aborted", "AbortError"));
        };
        function grant() {
          held = true;
          options.signal?.removeEventListener("abort", onAbort);
          Promise.resolve(callback({})).then(resolve, reject).finally(next);
        }
        if (options.ifAvailable) {
          if (held) resolve(void callback(null));
          else grant();
          return;
        }
        if (!opts.grantAfterAbort)
          options.signal?.addEventListener("abort", onAbort, { once: true });
        if (held) waiting.push(grant);
        else grant();
      }),
  );
  return {
    locks: { request } as unknown as Pick<LockManager, "request">,
    request,
    isHeld: () => held,
    freeOther: next,
  };
}
