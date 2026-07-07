/** Per-request deadline so a hung fetch settles instead of hanging forever. */

export interface DeadlineSignal {
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
