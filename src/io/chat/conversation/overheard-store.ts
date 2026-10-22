import {
  createPersistedStore,
  isPlainObject,
  localStorageStore,
  type PersistedStorage,
} from "../../../settings/persisted-store";

/** How far this window has heard another preset: the last delivered entry's ts and how many entries at exactly that ts. */
export interface OverheardCursor {
  ts: number;
  n: number;
}

type Cursors = Record<string, OverheardCursor>;

export type OverheardStorage = PersistedStorage<Cursors>;

const NOT_HEARD: OverheardCursor = { ts: 0, n: 0 };

function parse(value: unknown): Cursors | null {
  if (!isPlainObject(value)) return null;
  const out: Cursors = {};
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    const { ts, n } = (raw ?? {}) as Record<string, unknown>;
    if (typeof ts === "number" && typeof n === "number") out[id] = { ts, n };
  }
  return out;
}

export function createOverheardStore(opts?: { storage?: OverheardStorage }) {
  const core = createPersistedStore<Cursors>({
    storage: opts?.storage,
    defaults: {},
    parse,
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    clone: (v) => structuredClone(v),
  });

  return {
    get: (other: string): OverheardCursor => ({ ...(core.current()[other] ?? NOT_HEARD) }),
    set: (other: string, cursor: OverheardCursor): void =>
      core.commit({ ...core.current(), [other]: { ...cursor } }),
    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

export type OverheardStore = ReturnType<typeof createOverheardStore>;

export function localStorageOverheard(key = "yui.overheard"): OverheardStorage {
  return localStorageStore<Cursors>(key);
}
