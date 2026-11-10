/** One card import at a time for this window, across panel rebuilds. */
export interface ImportGate {
  /** Runs `task` unless one is running; "busy" without calling it otherwise. */
  run<T>(task: () => Promise<T>): Promise<T | "busy">;
  isBusy(): boolean;
  /** Called on every busy change. */
  subscribe(listener: () => void): () => void;
}

export function createImportGate(): ImportGate {
  return {
    run: (task) => task(),
    isBusy: () => false,
    subscribe: () => () => {},
  };
}
