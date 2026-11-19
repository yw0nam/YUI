import { useCallback, useState, useSyncExternalStore } from "react";

/**
 * Binds a source whose read returns a fresh object or array each call (a clone, a new list).
 * The value stays the same until the source notifies, and is read again just before React is told.
 */
export function useSnapshot<T>(read: () => T, subscribe: (cb: () => void) => () => void): T {
  const [box] = useState(() => ({ value: read() }));
  const onChange = useCallback(
    (cb: () => void) =>
      subscribe(() => {
        box.value = read();
        cb();
      }),
    [box, read, subscribe],
  );
  return useSyncExternalStore(onChange, () => box.value);
}
