/**
 * Rest settings — the device-wide Rest record (key "yui.dnd"); off is `{}`, never null in storage,
 * since a sibling window's reload rejects a stored null.
 */

import {
  createPersistedStore,
  isPlainObject,
  localStorageStore,
  type PersistedStorage,
} from "../persisted-store";
import { isRestChoice, type RestChoice } from "./rest-choices";
import { restEndsAt } from "./rest-end";

export interface RestRecord {
  choice?: RestChoice;
  startedAt?: number;
  endsAt?: number;
}

/** A record with a choice that has not ended. */
export type RunningRest = RestRecord & { choice: RestChoice };

const isTime = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function parse(v: unknown): RestRecord | null {
  if (!isPlainObject(v)) return null;
  const r = v as Record<string, unknown>;
  // The on/off flag this record replaced.
  if (typeof r.enabled === "boolean") return r.enabled ? { choice: "until_off" } : {};
  if (r.choice === undefined) return {};
  const { choice, startedAt, endsAt } = r;
  if (!isRestChoice(choice)) return null;
  if ((startedAt !== undefined && !isTime(startedAt)) || (endsAt !== undefined && !isTime(endsAt)))
    return null;
  return {
    choice,
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(endsAt === undefined ? {} : { endsAt }),
  };
}

export function createRestSettings(opts?: { storage?: PersistedStorage<RestRecord> }) {
  const core = createPersistedStore<RestRecord>({
    storage: opts?.storage,
    defaults: {},
    parse,
    equals: (a, b) => a.choice === b.choice && a.startedAt === b.startedAt && a.endsAt === b.endsAt,
  });

  return {
    /** The running Rest at `now`, or null when off or ended; an ended record stays stored. */
    get(now = Date.now()): RunningRest | null {
      const r = core.current();
      if (r.choice === undefined || (r.endsAt !== undefined && r.endsAt <= now)) return null;
      return { ...r } as RunningRest;
    },
    start(choice: RestChoice, now = Date.now()): void {
      const endsAt = restEndsAt(choice, now);
      core.commit({ choice, startedAt: now, ...(endsAt === undefined ? {} : { endsAt }) });
    },
    end(): void {
      core.commit({});
    },
    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

export type RestSettingsStore = ReturnType<typeof createRestSettings>;

export function localStorageRestStorage(key = "yui.dnd"): PersistedStorage<RestRecord> {
  return localStorageStore<RestRecord>(key);
}
