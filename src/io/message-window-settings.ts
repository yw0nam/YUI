/**
 * Reactive settings store for the message window — which side renders speech,
 * and where the window last sat.
 *
 * `mode` is read by the pet window to route the bubble and the input; `x`/`y`
 * are the message window's last outer position in physical px, written by that
 * window as it is dragged and null until it has been moved.
 *
 * Three windows hold an instance over the one key and each owns different fields,
 * so both setters merge over what storage holds rather than over their own copy.
 */

import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

export type MessageWindowMode = "docked" | "popped";

export interface MessageWindowSettings {
  mode: MessageWindowMode;
  x: number | null;
  y: number | null;
}

export type MessageWindowStorage = PersistedStorage<MessageWindowSettings>;

function isMode(v: unknown): v is MessageWindowMode {
  return v === "docked" || v === "popped";
}

function coord(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Parse a persisted blob. The mode is required; an unusable coordinate falls back to null. */
function parse(v: unknown): MessageWindowSettings | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const s = v as Record<string, unknown>;
  if (!isMode(s.mode)) return null;
  return { mode: s.mode, x: coord(s.x), y: coord(s.y) };
}

export function createMessageWindowSettings(opts?: {
  storage?: MessageWindowStorage;
  initial?: MessageWindowSettings;
}) {
  const core = createPersistedStore<MessageWindowSettings>({
    storage: opts?.storage,
    initial: opts?.initial,
    defaults: { mode: "docked", x: null, y: null },
    parse,
    equals: (a, b) => a.mode === b.mode && a.x === b.x && a.y === b.y,
  });

  return {
    get: core.get,

    setMode(mode: MessageWindowMode): void {
      if (!isMode(mode)) return;
      core.reloadFromStorage();
      core.commit({ ...core.get(), mode });
    },

    /** Record the window's outer position (physical px). Ignores a non-finite coordinate. */
    setPosition(x: number, y: number): void {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      core.reloadFromStorage();
      core.commit({ ...core.get(), x, y });
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

export type MessageWindowSettingsStore = ReturnType<typeof createMessageWindowSettings>;

/** localStorage-based MessageWindowStorage adapter. */
export function localStorageMessageWindowStorage(key = "yui.message-window"): MessageWindowStorage {
  return localStorageStore<MessageWindowSettings>(key);
}
