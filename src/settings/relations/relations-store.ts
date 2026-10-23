import type { RelationBand } from "../../contract/types";
import {
  createPersistedStore,
  isPlainObject,
  localStorageStore,
  type PersistedStorage,
} from "../persisted-store";

export interface RelationChange {
  at: number;
  delta: number;
  why: string;
}

export interface RelationRecord {
  value: number;
  updated_at: number;
  /** Newest first. */
  log: RelationChange[];
  /** An external engine's summary; the client never writes it. */
  note?: string;
}

/** Keyed `"user"` or a preset id. */
export type Relations = Record<string, RelationRecord>;

export type RelationsStorage = PersistedStorage<Relations>;

export interface RateOutcome {
  band: RelationBand;
  applied: number;
  clamped: boolean;
}

const MAX = 20;
const DAILY_POINTS = 4;
const LOG_LENGTH = 20;
export const WHY_LENGTH = 80;
const NOTE_LENGTH = 200;
/** The accepted step sizes of one change. */
export const DELTAS: readonly number[] = [-2, -1, 1, 2];

export function bandOf(value: number): RelationBand {
  if (value <= -12) return "hostile";
  if (value <= -4) return "cold";
  if (value >= 12) return "close";
  if (value >= 4) return "warm";
  return "neutral";
}

function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function parseChange(raw: unknown): RelationChange | null {
  const { at, delta, why } = (raw ?? {}) as Record<string, unknown>;
  if (typeof at !== "number" || typeof why !== "string") return null;
  if (!Number.isInteger(delta) || delta === 0 || !DELTAS.includes(delta as number)) return null;
  return { at, delta: delta as number, why: why.slice(0, WHY_LENGTH) };
}

function parse(value: unknown): Relations | null {
  if (!isPlainObject(value)) return null;
  const out: Relations = {};
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    const { value: v, updated_at, log, note } = (raw ?? {}) as Record<string, unknown>;
    if (!Number.isInteger(v) || Math.abs(v as number) > MAX) continue;
    if (typeof updated_at !== "number" || !Array.isArray(log)) continue;
    const changes = log.map(parseChange).filter((c): c is RelationChange => c !== null);
    out[id] = {
      value: v as number,
      updated_at,
      log: changes.slice(0, LOG_LENGTH),
      ...(typeof note === "string" ? { note: note.slice(0, NOTE_LENGTH) } : {}),
    };
  }
  return out;
}

/** One preset's directed relation toward the user and each other preset. */
export function createRelationsStore(opts?: { storage?: RelationsStorage }) {
  const core = createPersistedStore<Relations>({
    storage: opts?.storage,
    defaults: {},
    parse,
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    clone: (v) => structuredClone(v),
  });

  return {
    all: (): Relations => structuredClone(core.current()),
    /** Applies `delta` as far as the daily cap and the range allow. */
    rate(target: string, delta: number, why: string, nowMs: number): RateOutcome {
      const record = core.current()[target] ?? { value: 0, updated_at: 0, log: [] };
      const today = dayKey(nowMs);
      const spent = record.log
        .filter((c) => dayKey(c.at) === today)
        .reduce((sum, c) => sum + Math.abs(c.delta), 0);
      const sign = Math.sign(delta);
      const allowed = Math.min(Math.abs(delta), DAILY_POINTS - spent, MAX - sign * record.value);
      if (allowed <= 0) return { band: bandOf(record.value), applied: 0, clamped: true };
      const value = record.value + sign * allowed;
      const change = { at: nowMs, delta: sign * allowed, why: why.trim().slice(0, WHY_LENGTH) };
      core.commit({
        ...core.current(),
        [target]: {
          ...record,
          value,
          updated_at: nowMs,
          log: [change, ...record.log].slice(0, LOG_LENGTH),
        },
      });
      return { band: bandOf(value), applied: allowed, clamped: allowed < Math.abs(delta) };
    },
    /** Replaces the whole store; false and no write when `next` does not parse. */
    replace(next: unknown): boolean {
      const parsed = parse(next);
      if (parsed === null) return false;
      core.commit(parsed);
      return true;
    },
    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

export type RelationsStore = ReturnType<typeof createRelationsStore>;

export function localStorageRelations(key = "yui.relations"): RelationsStorage {
  return localStorageStore<Relations>(key);
}
