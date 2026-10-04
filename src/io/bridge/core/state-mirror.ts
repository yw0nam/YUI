/**
 * state-mirror — one value owned by one window and mirrored into the others over the bridge.
 *
 * The owner publishes the whole value on every change and again when a window asks. A reading
 * window starts from an initial value and asks at once, so a window opened late still catches up.
 */

/** Owner side: re-emits the value on every change and whenever a window asks. Returns its teardown. */
export function publishState<T>(deps: {
  get(): T;
  subscribe(cb: (value: T) => void): () => void;
  emit(value: T): void;
  onAsk(cb: () => void): () => void;
}): () => void {
  const unsubscribes = [
    deps.subscribe((value) => deps.emit(value)),
    deps.onAsk(() => deps.emit(deps.get())),
  ];
  return () => {
    for (const off of unsubscribes) off();
  };
}

export interface StateMirror<T> {
  get(): T;
  subscribe(cb: (value: T) => void): () => void;
  /** Ask the owner again. */
  refresh(): void;
  dispose(): void;
}

/** Reader side: holds the owner's last value, tells subscribers on each change, and asks at once. */
export function createStateMirror<T>(deps: {
  initial: T;
  on(cb: (value: T) => void): () => void;
  ask(): void;
}): StateMirror<T> {
  const subscribers = new Set<(value: T) => void>();
  let value = deps.initial;

  const off = deps.on((next) => {
    value = next;
    for (const cb of subscribers) cb(next);
  });
  deps.ask();

  return {
    get: () => value,

    subscribe(cb): () => void {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },

    refresh(): void {
      deps.ask();
    },

    dispose(): void {
      off();
      subscribers.clear();
    },
  };
}
