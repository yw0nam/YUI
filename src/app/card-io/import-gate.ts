/** One card import at a time for this window, across panel rebuilds. */
export interface ImportGate {
  /** Runs `task` unless one is running; "busy" without calling it otherwise. */
  run<T>(task: () => Promise<T>): Promise<T | "busy">;
  isBusy(): boolean;
  /** Called on every busy change. */
  subscribe(listener: () => void): () => void;
}

export function createImportGate(): ImportGate {
  let busy = false;
  const listeners = new Set<() => void>();
  const set = (next: boolean): void => {
    busy = next;
    for (const listener of listeners) listener();
  };
  return {
    async run(task) {
      if (busy) return "busy";
      set(true);
      try {
        return await task();
      } finally {
        set(false);
      }
    },
    isBusy: () => busy,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
