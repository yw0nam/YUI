/**
 * Waiting list — the self-started candidates that cannot speak now, ranked by class, then oldest.
 *
 * Pure: no clock, no I/O. Keep rules run on `add`: the newest idle cue per cue id, the newest
 * three screen reactions, then at most ten entries (the lowest class, then the oldest, leave first).
 * Signal groups never enter; they stay in their own buffers.
 */

import { GRACE_MINUTES } from "../sources/idle-tick/schedule-source";
import { type WaitClass, waitClassOf } from "./classify";
import type { BusEnvelope } from "./event-bus";

export interface WaitingEntry {
  /** Short and stable for the entry's life: `w1`, `w2`, … */
  id: string;
  env: BusEnvelope;
  cls: WaitClass;
  /** Epoch ms the entry stops waiting at; absent for the on-activity entries. */
  expiresAt?: number;
  /** Expires on the next user activity: idle cues, gesture reactions, screen reactions. */
  onActivity: boolean;
}

export interface WaitingList {
  add(env: BusEnvelope): { entry: WaitingEntry; evicted: WaitingEntry[] };
  expire(now: number): WaitingEntry[];
  expireOnActivity(): WaitingEntry[];
  /** Removes and returns the entries `pred` accepts, in rank order. */
  take(pred: (entry: WaitingEntry) => boolean): WaitingEntry[];
  /** Returns taken entries unchanged, ids and times kept. */
  putBack(entries: readonly WaitingEntry[]): void;
  /** Every entry in rank order. */
  snapshot(): WaitingEntry[];
}

const MAX_ENTRIES = 10;
const MAX_SCREEN = 3;
const RANK: Record<WaitClass, number> = { now: 0, scheduled: 1, room: 2 };

const byRank = (a: WaitingEntry, b: WaitingEntry): number =>
  RANK[a.cls] - RANK[b.cls] || a.env.ts - b.env.ts;

const isIdleCue = (env: BusEnvelope): boolean =>
  env.source === "timer_scheduler" && env.event_name.startsWith("proactive.");

function endOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

/** The first meeting and addressed lines last their local day; a schedule cue its grace window, clamped to that day. */
function expiresAtOf(env: BusEnvelope): number | undefined {
  if (env.source === "addressed_source" || env.event_name.startsWith("time_milestone.")) {
    return endOfLocalDay(env.ts);
  }
  const time = env.payload?.time;
  if (!env.event_name.startsWith("schedule.") || typeof time !== "string") return undefined;
  const [hour, minute] = time.split(":").map(Number);
  const due = new Date(env.ts);
  due.setHours(hour!, minute! + GRACE_MINUTES, 0, 0);
  return Math.min(due.getTime(), endOfLocalDay(env.ts));
}

export function createWaitingList(): WaitingList {
  let entries: WaitingEntry[] = [];
  let nextId = 1;

  /** Removes and returns the entries `pred` accepts, in rank order. */
  function remove(pred: (entry: WaitingEntry) => boolean): WaitingEntry[] {
    const gone = entries.filter(pred).sort(byRank);
    entries = entries.filter((e) => !pred(e));
    return gone;
  }

  return {
    add(env) {
      const cls = waitClassOf(env);
      const entry: WaitingEntry = {
        id: `w${nextId++}`,
        env,
        cls,
        expiresAt: expiresAtOf(env),
        onActivity:
          cls === "room" ||
          (env.source === "os_event_watcher" && env.event_name.startsWith("proactive.")),
      };
      const evicted = isIdleCue(env)
        ? remove((e) => isIdleCue(e.env) && e.env.payload?.cue_id === env.payload?.cue_id)
        : [];
      entries.push(entry);
      const screens = entries.filter((e) => e.env.source === "screen_watcher").sort(byRank);
      const oldScreens = new Set(screens.slice(0, -MAX_SCREEN));
      evicted.push(...remove((e) => oldScreens.has(e)));
      while (entries.length > MAX_ENTRIES) {
        const worst = entries.reduce((w, e) =>
          RANK[e.cls] > RANK[w.cls] || (RANK[e.cls] === RANK[w.cls] && e.env.ts < w.env.ts) ? e : w,
        );
        evicted.push(...remove((e) => e === worst));
      }
      return { entry, evicted };
    },
    expire: (now) => remove((e) => e.expiresAt !== undefined && e.expiresAt <= now),
    expireOnActivity: () => remove((e) => e.onActivity),
    take: remove,
    putBack(back) {
      entries.push(...back);
    },
    snapshot: () => [...entries].sort(byRank),
  };
}
