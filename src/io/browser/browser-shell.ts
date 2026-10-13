/**
 * The browser tool's door to the Rust shell. A call forwards to `browser_run` under the generation
 * it was accepted in, and only while that generation is still the latest the shell acknowledged,
 * so a cancel answers every call accepted before it without that call reaching Chrome.
 * invoke is test-injectable (defaults to the real @tauri-apps/api/core invoke).
 */

import { invoke as tauriInvoke } from "@tauri-apps/api/core";

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

const CANCELLED = "cancelled: nothing ran";
/** How long after acceptance the shell may still start a call; the tool's 32 s wait covers it. */
const RUN_DEADLINE_MS = 30_000;

export interface BrowserShell {
  /** Runs the action and resolves the tool result the shell formatted. An abort cancels it. */
  run(action: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string>;
  /** Cancels every call accepted so far. */
  cancel(): void;
  /** Cancels every call accepted so far, then stops the owned Chrome. */
  stop(): Promise<void>;
}

export function createBrowserShell(
  invoke: InvokeFn = tauriInvoke,
  now: () => number = Date.now,
): BrowserShell {
  const rejected = new WeakSet<Promise<number>>();
  // The latest generation barrier: the shell's current generation once it settles.
  let genP: Promise<number>;
  const setGen = (next: Promise<number>): void => {
    genP = next;
    next.catch(() => rejected.add(next));
  };
  setGen(invoke<number>("browser_generation"));

  function cancel(): void {
    setGen(genP.catch(() => undefined).then(() => invoke<number>("browser_cancel")));
  }

  async function forward(
    accepted: Promise<number>,
    deadlineAt: number,
    action: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    let captured: number;
    let current: number;
    try {
      captured = await accepted;
      let barrier: Promise<number>;
      do {
        barrier = genP;
        current = await barrier;
      } while (barrier !== genP);
    } catch {
      return CANCELLED;
    }
    if (captured !== current || now() >= deadlineAt) return CANCELLED;
    return invoke<string>("browser_run", { gen: captured, deadlineAt, action, args });
  }

  return {
    async run(action, args, signal) {
      // A failed cancel leaves every call cancelled until a later cancel is acknowledged.
      if (rejected.has(genP)) setGen(genP.catch(() => invoke<number>("browser_cancel")));
      const accepted = genP;
      const deadlineAt = now() + RUN_DEADLINE_MS;
      const onAbort = (): void => cancel();
      if (signal?.aborted) cancel();
      else signal?.addEventListener("abort", onAbort, { once: true });
      try {
        return await forward(accepted, deadlineAt, action, args);
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
    },
    cancel,
    async stop() {
      cancel();
      await genP.catch(() => undefined);
      await invoke("browser_stop");
    },
  };
}
