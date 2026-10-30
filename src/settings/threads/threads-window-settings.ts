/** The Threads window's per-device frame and list choice. */

import { localStorageStore, type PersistedStorage } from "../persisted-store";

export interface ThreadsWindowSettings {
  x?: number;
  y?: number;
  width: number;
  height: number;
  listCollapsed: boolean;
}

export type ThreadsWindowStorage = PersistedStorage<ThreadsWindowSettings>;

export function createThreadsWindowSettings(_opts?: { storage?: ThreadsWindowStorage }) {
  return {
    get: (): ThreadsWindowSettings => ({ width: 0, height: 0, listCollapsed: false }),
    setFrame(_frame: { x: number; y: number; width: number; height: number }): void {},
    setListCollapsed(_collapsed: boolean): void {},
  };
}

export function localStorageThreadsWindowStorage(key = "yui.threads-window"): ThreadsWindowStorage {
  return localStorageStore<ThreadsWindowSettings>(key);
}
