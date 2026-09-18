/** Per-request deadline so a hung fetch settles instead of hanging forever. */

interface DeadlineSignal {
  signal: AbortSignal;
  clear: () => void;
}

// setTimeout-based (not AbortSignal.timeout) so tests can drive it with fake timers deterministically —
// AbortSignal.timeout schedules via an internal timer that vi.useFakeTimers() cannot advance.
export function createDeadlineSignal(ms: number, message: string): DeadlineSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException(message, "TimeoutError")), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

/** Resolves like `promise`, or rejects with `signal.reason` when the signal aborts first. */
export function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void promise.catch(() => {});
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
