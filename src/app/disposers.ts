/** Shared teardown bag — every long-lived resource registers its teardown at its creation site. */

export interface Disposers {
  register(fn: () => void): void;
  dispose(): void;
  isDisposed(): boolean;
}

export function createDisposers(): Disposers {
  const teardowns: Array<() => void> = [];
  let disposed = false;
  return {
    register(fn) {
      if (disposed) fn();
      else teardowns.push(fn);
    },
    // Drains LIFO (reverse of registration) — one failure does not strand the rest, the first rethrows.
    dispose() {
      disposed = true;
      let firstError: unknown;
      let failed = false;
      while (teardowns.length) {
        try {
          teardowns.pop()!();
        } catch (error) {
          if (!failed) firstError = error;
          failed = true;
        }
      }
      if (failed) throw firstError;
    },
    isDisposed: () => disposed,
  };
}
