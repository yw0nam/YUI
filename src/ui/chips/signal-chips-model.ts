/** Signal chips model — the signal groups beside the avatar, newest first, in memory only. */

import type { SignalGroup } from "../../contract";
import { DELEGATION_DONE_TTL_MS } from "../../io/bridge/delegations/delegations-store";
import type { SignalRecord } from "../../io/chat/conversation/signal-history-store";
import { DELEGATION_REFRESH_MS } from "./delegation-rows";

export interface SignalChipItem {
  group: SignalGroup;
  /** The group's delivery class. */
  delivery: "urgent" | "batched";
  received_at: number;
  /** What YUI said on the turn that ran this group, null while silent or unknown. */
  said: string | null;
}

interface Held {
  group: SignalGroup;
  received_at: number;
}

export function createSignalChipsModel({
  history,
  now = Date.now,
}: {
  history: { records(): SignalRecord[]; subscribe(cb: () => void): () => void };
  now?: () => number;
}) {
  let held: Held[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;
  const subscribers = new Set<() => void>();

  const emit = (): void => {
    for (const cb of subscribers) cb();
  };

  // The expiry tick runs only while a batched chip exists.
  function syncTimer(): void {
    const needed = held.some((h) => h.group.envelope.delivery === "batched");
    if (needed && timer === null) timer = setInterval(expire, DELEGATION_REFRESH_MS);
    if (!needed && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  function expire(): void {
    const kept = held.filter(
      (h) =>
        h.group.envelope.delivery === "urgent" || now() - h.received_at < DELEGATION_DONE_TTL_MS,
    );
    if (kept.length === held.length) return;
    held = kept;
    syncTimer();
    emit();
  }

  function saidOf(eventId: string): string | null {
    const rows = history.records();
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i]!.event_id === eventId) return rows[i]!.said;
    }
    return null;
  }

  const offHistory = history.subscribe(emit);

  return {
    add(group: SignalGroup): void {
      const at = held.findIndex((h) => h.group.envelope.event_id === group.envelope.event_id);
      if (at >= 0) held[at] = { group, received_at: held[at]!.received_at };
      else held = [{ group, received_at: now() }, ...held];
      syncTimer();
      emit();
    },

    dismiss(eventId: string): void {
      held = held.filter((h) => h.group.envelope.event_id !== eventId);
      syncTimer();
      emit();
    },

    list(): SignalChipItem[] {
      return held.map((h) => ({
        group: h.group,
        delivery: h.group.envelope.delivery,
        received_at: h.received_at,
        said: saidOf(h.group.envelope.event_id),
      }));
    },

    subscribe(cb: () => void): () => void {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },

    dispose(): void {
      offHistory();
      if (timer !== null) clearInterval(timer);
      timer = null;
      subscribers.clear();
    },
  };
}

export type SignalChipsModel = ReturnType<typeof createSignalChipsModel>;
