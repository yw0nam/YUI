/**
 * delegations-store.test.ts — the list of background work the backend reports over the push socket.
 */

import { describe, expect, it, vi } from "vitest";
import type { DelegationItem } from "../chat/push-socket";
import {
  createDelegationsStore,
  DELEGATION_DONE_TTL_MS,
  DELEGATION_TITLE_MAX_LEN,
  DELEGATIONS_MAX_ITEMS,
} from "./delegations-store";

const NOW = 1_789_365_900_000;

function running(id: string): DelegationItem {
  return { id, title: `work ${id}`, started_at: NOW - 60_000, state: "running" };
}

function done(id: string, endedAt: number): DelegationItem {
  return { id, title: `work ${id}`, started_at: NOW - 600_000, state: "done", ended_at: endedAt };
}

function store(now = () => NOW) {
  return createDelegationsStore({ now });
}

describe("createDelegationsStore", () => {
  it("starts empty", () => {
    expect(store().get()).toEqual([]);
  });

  it("replaces the whole list with each frame", () => {
    const s = store();
    s.replace([running("d-1"), running("d-2")]);
    s.replace([running("d-3")]);
    expect(s.get().map((d) => d.id)).toEqual(["d-3"]);
  });

  it("keeps a done item until its 30-minute window is up", () => {
    const s = store();
    s.replace([done("d-1", NOW - DELEGATION_DONE_TTL_MS + 1_000)]);
    expect(s.get().map((d) => d.id)).toEqual(["d-1"]);
  });

  it("drops a done item 30 minutes after it ended", () => {
    const s = store();
    s.replace([done("d-1", NOW - DELEGATION_DONE_TTL_MS), running("d-2")]);
    expect(s.get().map((d) => d.id)).toEqual(["d-2"]);
  });

  it("expires a done item as the clock passes its window", () => {
    let clock = NOW;
    const s = createDelegationsStore({ now: () => clock });
    s.replace([done("d-1", NOW)]);
    expect(s.get()).toHaveLength(1);

    clock = NOW + DELEGATION_DONE_TTL_MS + 1;
    expect(s.get()).toEqual([]);
  });

  it("keeps running items however old they are", () => {
    const s = store();
    s.replace([{ ...running("d-1"), started_at: 0 }]);
    expect(s.get()).toHaveLength(1);
  });

  it("counts only the running items", () => {
    const s = store();
    s.replace([running("d-1"), running("d-2"), done("d-3", NOW)]);
    expect(s.runningCount()).toBe(2);
  });

  it("notifies subscribers with the visible list on every replace", () => {
    const s = store();
    const seen: DelegationItem[][] = [];
    s.subscribe((items) => seen.push(items));
    s.replace([running("d-1"), done("d-2", NOW - DELEGATION_DONE_TTL_MS)]);

    expect(seen).toHaveLength(1);
    expect(seen[0]!.map((d) => d.id)).toEqual(["d-1"]);
  });

  it("stops notifying after the subscription is dropped", () => {
    const s = store();
    const cb = vi.fn();
    s.subscribe(cb)();
    s.replace([running("d-1")]);
    expect(cb).not.toHaveBeenCalled();
  });

  it("drops an item that is missing an id, a title, or a known state", () => {
    const s = store();
    s.replace([
      running("d-1"),
      { id: "", title: "x", started_at: NOW, state: "running" },
      { id: "d-2", title: "x", started_at: NOW, state: "queued" } as unknown as DelegationItem,
      { id: "d-3", started_at: NOW, state: "running" } as unknown as DelegationItem,
    ]);
    expect(s.get().map((d) => d.id)).toEqual(["d-1"]);
  });

  it("cuts a title to its limit", () => {
    const s = store();
    s.replace([{ ...running("d-1"), title: "x".repeat(DELEGATION_TITLE_MAX_LEN + 40) }]);
    expect(s.get()[0]!.title).toHaveLength(DELEGATION_TITLE_MAX_LEN);
  });

  it("keeps at most the item limit", () => {
    const s = store();
    s.replace(Array.from({ length: DELEGATIONS_MAX_ITEMS + 10 }, (_, i) => running(`d-${i}`)));
    expect(s.get()).toHaveLength(DELEGATIONS_MAX_ITEMS);
  });

  it("keeps status and summary on a done item", () => {
    const s = store();
    s.replace([{ ...done("d-1", NOW - 1000), status: "error", summary: "Disk full." }]);
    expect(s.get()[0]!.status).toBe("error");
    expect(s.get()[0]!.summary).toBe("Disk full.");
  });

  it("drops a status it does not know, a summary that is not text, and both on a running item", () => {
    const s = store();
    s.replace([
      { ...done("d-1", NOW - 1000), status: "meh", summary: 42 },
      { ...running("d-2"), status: "ok", summary: "early" },
    ] as unknown as DelegationItem[]);
    for (const item of s.get()) {
      expect("status" in item).toBe(false);
      expect("summary" in item).toBe(false);
    }
  });
});
