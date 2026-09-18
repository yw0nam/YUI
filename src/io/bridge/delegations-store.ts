/**
 * delegations-store — the background work the backend reports on the push socket.
 *
 * Each `delegations` frame replaces the list. A finished item stays visible for a while so the
 * user can still see what just completed, then leaves on its own; a running item never expires.
 */

import type { DelegationItem } from "../chat/push-socket";

/** How long a `done` item stays in the list after `ended_at`. */
export const DELEGATION_DONE_TTL_MS = 30 * 60 * 1000;
export const DELEGATION_TITLE_MAX_LEN = 120;
export const DELEGATIONS_MAX_ITEMS = 50;

export interface DelegationsStore {
  /** Adopt a `delegations` frame's items, replacing everything held. */
  replace(items: DelegationItem[]): void;
  /** The items visible now — malformed and expired ones excluded. */
  get(): DelegationItem[];
  runningCount(): number;
  subscribe(cb: (items: DelegationItem[]) => void): () => void;
}

function sanitize(raw: unknown): DelegationItem | null {
  if (raw === null || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.id !== "string" || v.id === "") return null;
  if (typeof v.title !== "string") return null;
  if (v.state !== "running" && v.state !== "done") return null;
  return {
    id: v.id,
    title: v.title.slice(0, DELEGATION_TITLE_MAX_LEN),
    started_at: typeof v.started_at === "number" ? v.started_at : 0,
    state: v.state,
    ...(typeof v.ended_at === "number" ? { ended_at: v.ended_at } : {}),
    ...(v.state === "done" && (v.status === "ok" || v.status === "error" || v.status === "unknown")
      ? { status: v.status }
      : {}),
    ...(v.state === "done" && typeof v.summary === "string" ? { summary: v.summary } : {}),
  };
}

export function createDelegationsStore(deps: { now?: () => number } = {}): DelegationsStore {
  const now = deps.now ?? Date.now;
  const subscribers = new Set<(items: DelegationItem[]) => void>();
  let items: DelegationItem[] = [];

  function visible(): DelegationItem[] {
    const cutoff = now() - DELEGATION_DONE_TTL_MS;
    return items.filter(
      (item) => item.state === "running" || item.ended_at === undefined || item.ended_at > cutoff,
    );
  }

  return {
    replace(next): void {
      items = (Array.isArray(next) ? next : [])
        .map(sanitize)
        .filter((item): item is DelegationItem => item !== null)
        .slice(0, DELEGATIONS_MAX_ITEMS);
      const list = visible();
      for (const cb of subscribers) cb(list);
    },

    get: visible,

    runningCount(): number {
      return visible().filter((item) => item.state === "running").length;
    },

    subscribe(cb): () => void {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },
  };
}
