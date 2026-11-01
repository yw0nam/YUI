/**
 * threads-window-settings — the Threads window's frame (its panel's screen rect in logical px),
 * whether its list is collapsed to the rail, and the list's dragged width. Per device: never synced
 * cross-window.
 */

import {
  createPersistedStore,
  isPlainObject,
  localStorageStore,
  type PersistedStorage,
} from "../persisted-store";

/** The smallest panel the window takes. */
export const THREADS_MIN_PANEL = { width: 360, height: 420 } as const;

export interface ThreadsWindowSettings {
  /** The panel's top-left; absent until the window first opened. */
  x?: number;
  y?: number;
  width: number;
  height: number;
  listCollapsed: boolean;
  /** The list's dragged width in px; absent for the default width. */
  listWidth?: number;
}

export type ThreadsWindowStorage = PersistedStorage<ThreadsWindowSettings>;

const DEFAULTS: ThreadsWindowSettings = { width: 880, height: 680, listCollapsed: false };

function parse(v: unknown): ThreadsWindowSettings | null {
  if (!isPlainObject(v)) return null;
  const { x, y, width, height, listCollapsed, listWidth } = v as Record<string, unknown>;
  const int = (n: unknown): n is number => Number.isInteger(n);
  if (!int(width) || !int(height) || typeof listCollapsed !== "boolean") return null;
  if (width < THREADS_MIN_PANEL.width || height < THREADS_MIN_PANEL.height) return null;
  // A width that is not whole px reads as the default, keeping the frame.
  const list = int(listWidth) ? { listWidth } : {};
  if (x === undefined && y === undefined) return { width, height, listCollapsed, ...list };
  return int(x) && int(y) ? { x, y, width, height, listCollapsed, ...list } : null;
}

export function createThreadsWindowSettings(opts?: { storage?: ThreadsWindowStorage }) {
  const core = createPersistedStore<ThreadsWindowSettings>({
    storage: opts?.storage,
    defaults: DEFAULTS,
    parse,
    equals: (a, b) =>
      a.x === b.x &&
      a.y === b.y &&
      a.width === b.width &&
      a.height === b.height &&
      a.listCollapsed === b.listCollapsed &&
      a.listWidth === b.listWidth,
  });

  return {
    get: core.get,

    /** Saves the panel's frame, its size floored at the minimum. */
    setFrame(frame: { x: number; y: number; width: number; height: number }): void {
      core.commit({
        ...core.current(),
        x: Math.round(frame.x),
        y: Math.round(frame.y),
        width: Math.max(THREADS_MIN_PANEL.width, Math.round(frame.width)),
        height: Math.max(THREADS_MIN_PANEL.height, Math.round(frame.height)),
      });
    },

    setListCollapsed(listCollapsed: boolean): void {
      core.commit({ ...core.current(), listCollapsed });
    },

    /** Saves the list's dragged width; null goes back to the default. */
    setListWidth(width: number | null): void {
      const { listWidth: _, ...rest } = core.current();
      core.commit(width === null ? rest : { ...rest, listWidth: Math.round(width) });
    },
  };
}

export type ThreadsWindowSettingsStore = ReturnType<typeof createThreadsWindowSettings>;

/** localStorage-backed ThreadsWindowStorage adapter. Gracefully ignored where localStorage is unavailable. */
export function localStorageThreadsWindowStorage(key = "yui.threads-window"): ThreadsWindowStorage {
  return localStorageStore<ThreadsWindowSettings>(key);
}
