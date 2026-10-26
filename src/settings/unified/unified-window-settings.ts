/**
 * Where the unified chat window last sat: its outer position in physical px, written by that
 * window as it is dragged and null until it has been moved. Device-wide.
 */

import { createPersistedStore, localStorageStore, type PersistedStorage } from "../persisted-store";

export interface UnifiedWindowSettings {
  x: number | null;
  y: number | null;
}

function coord(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function parse(v: unknown): UnifiedWindowSettings | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const s = v as Record<string, unknown>;
  return { x: coord(s.x), y: coord(s.y) };
}

export function createUnifiedWindowSettings(opts?: {
  storage?: PersistedStorage<UnifiedWindowSettings>;
}) {
  const core = createPersistedStore<UnifiedWindowSettings>({
    storage: opts?.storage ?? localStorageStore("yui.unified-window"),
    defaults: { x: null, y: null },
    parse,
    equals: (a, b) => a.x === b.x && a.y === b.y,
  });
  return {
    get: core.get,
    /** Record the window's outer position (physical px). Ignores a non-finite coordinate. */
    setPosition(x: number, y: number): void {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      core.commit({ x, y });
    },
    reloadFromStorage: core.reloadFromStorage,
    dispose: core.dispose,
  };
}
