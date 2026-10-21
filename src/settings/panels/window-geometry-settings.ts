/**
 * Window geometry — the size and position the user's OS drags and Ctrl+wheel resizes leave, per
 * window label. A Partial record: a size saved before any drop (or the reverse) still applies alone.
 */

import {
  createPersistedStore,
  isPlainObject,
  localStorageStore,
  type PersistedStorage,
} from "../persisted-store";

interface WindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type StoredWindowGeometry = Partial<WindowGeometry>;

const KEYS = ["x", "y", "width", "height"] as const;

/** Device-wide per label, never per preset: `main` keeps its geometry across preset switches. */
export function localStorageWindowGeometryStorage(
  label: string,
): PersistedStorage<StoredWindowGeometry> {
  return localStorageStore(`yui.window.${label}`, { resolve: false });
}

export function createWindowGeometrySettings(opts?: {
  storage?: PersistedStorage<StoredWindowGeometry>;
}) {
  const core = createPersistedStore<StoredWindowGeometry>({
    storage: opts?.storage,
    defaults: {},
    parse: (v) => {
      if (!isPlainObject(v)) return null;
      const raw = v as Record<string, unknown>;
      const out: StoredWindowGeometry = {};
      for (const k of KEYS) {
        const n = raw[k];
        if (typeof n === "number" && Number.isFinite(n)) out[k] = n;
      }
      return out;
    },
    equals: (a, b) => KEYS.every((k) => a[k] === b[k]),
  });

  return {
    get: core.get,
    setSize: (size: { width: number; height: number }): void =>
      core.commit({ ...core.current(), width: size.width, height: size.height }),
    setPosition: (pos: { x: number; y: number }): void =>
      core.commit({ ...core.current(), x: pos.x, y: pos.y }),
    dispose: core.dispose,
  };
}

export type WindowGeometrySettings = ReturnType<typeof createWindowGeometrySettings>;
