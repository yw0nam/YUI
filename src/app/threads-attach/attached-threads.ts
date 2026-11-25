/** Main's attached Threads: each Thread once, in the order attached. */

import type { AttachedThread } from "../../contract";

export interface AttachedThreads {
  get(): AttachedThread[];
  /** Calls `cb` with the list after each change. */
  subscribe(cb: (threads: AttachedThread[]) => void): () => void;
  /** Adds the Thread, or removes it when it is attached; true when it added. */
  toggle(thread: AttachedThread): boolean;
  /** Removes these Threads, keeping any attached since. */
  drop(threads: AttachedThread[]): void;
  /** Adds back the Threads not attached already. */
  restore(threads: AttachedThread[]): void;
}

export function createAttachedThreads(): AttachedThreads {
  let list: AttachedThread[] = [];
  const subscribers = new Set<(threads: AttachedThread[]) => void>();
  const has = (id: string): boolean => list.some((t) => t.id === id);
  const set = (next: AttachedThread[]): void => {
    // Every change adds or removes, so an equal length is no change.
    if (next.length === list.length) return;
    list = next;
    for (const cb of subscribers) cb(list);
  };
  return {
    get: () => list,
    subscribe(cb) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    toggle(thread) {
      const adds = !has(thread.id);
      set(adds ? [...list, thread] : list.filter((t) => t.id !== thread.id));
      return adds;
    },
    drop(threads) {
      set(list.filter((t) => !threads.some((d) => d.id === t.id)));
    },
    restore(threads) {
      set([...list, ...threads.filter((t) => !has(t.id))]);
    },
  };
}
