/** Binds an outside store to a signal: the snapshot stays one value across reads that return an equal one. */

import { type Accessor, createSignal, onCleanup } from "solid-js";

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** A port's `read` is cloned or rebuilt on every call, so the signal takes the new read only when it differs. */
export function fromExternal<T>(
  read: () => T,
  subscribe?: (cb: () => void) => () => void,
): Accessor<T> {
  const [value, setValue] = createSignal<T>(() => read(), { equals: same });
  if (subscribe) onCleanup(subscribe(() => setValue(() => read())));
  return value;
}
