/**
 * delegation-history.test.ts — the persisted list of every delegation the client has seen,
 * folded forward across `delegations` frames and read back by the settings window.
 */

import { describe, expect, it } from "vitest";
import type { DelegationItem } from "../chat/push-socket";
import {
  createDelegationHistory,
  DELEGATION_HISTORY_MAX_ITEMS,
  type DelegationHistoryStorage,
} from "./delegation-history";

const NOW = 1_789_365_900_000;

function running(id: string): DelegationItem {
  return { id, title: `work ${id}`, started_at: NOW - 60_000, state: "running" };
}

function done(id: string, endedAt: number, extra: Partial<DelegationItem> = {}): DelegationItem {
  return {
    id,
    title: `work ${id}`,
    started_at: NOW - 600_000,
    state: "done",
    ended_at: endedAt,
    ...extra,
  };
}

function memoryStorage(initial: unknown = null) {
  const mem = { saved: initial };
  return {
    storage: {
      load: () => mem.saved,
      save: (v: DelegationItem[]) => {
        mem.saved = v;
      },
    } as DelegationHistoryStorage,
    set(v: unknown): void {
      mem.saved = v;
    },
  };
}

describe("createDelegationHistory", () => {
  it("adds the frame's items and keeps the ones a later frame no longer lists", () => {
    const { storage } = memoryStorage();
    const history = createDelegationHistory({ storage, now: () => NOW });
    history.merge([running("a"), done("b", NOW - 60_000)]);
    history.merge([]);

    const ids = history.get().map((d) => d.id);
    expect(ids).toContain("b");
    expect(ids).toContain("a");
  });

  it("replaces a record by id when a later frame reports it done with its outcome", () => {
    const history = createDelegationHistory({ now: () => NOW });
    history.merge([running("a")]);
    history.merge([done("a", NOW - 60_000, { status: "ok", summary: "Finished." })]);

    const items = history.get();
    expect(items).toHaveLength(1);
    expect(items[0]!.state).toBe("done");
    expect(items[0]!.summary).toBe("Finished.");
  });

  it("marks a running item a frame leaves out as done with an unknown status", () => {
    const history = createDelegationHistory({ now: () => NOW });
    history.merge([running("a")]);
    history.merge([]);

    const [a] = history.get();
    expect(a!.state).toBe("done");
    expect(a!.ended_at).toBe(NOW);
    expect(a!.status).toBe("unknown");
    expect(a!.summary).toBeUndefined();
  });

  it("orders running first, then done newest first", () => {
    const history = createDelegationHistory({ now: () => NOW });
    history.merge([
      done("old", NOW - 3 * 60 * 60_000),
      done("new", NOW - 60 * 60_000),
      running("r"),
    ]);

    expect(history.get().map((d) => d.id)).toEqual(["r", "new", "old"]);
  });

  it("keeps at most 200 items, dropping the oldest done first and never a running one", () => {
    const history = createDelegationHistory({ now: () => NOW });
    history.merge([
      ...Array.from({ length: DELEGATION_HISTORY_MAX_ITEMS }, (_, i) =>
        done(`d-${i}`, NOW - 10_000 + i),
      ),
      running("r-1"),
      running("r-2"),
    ]);

    const items = history.get();
    expect(items).toHaveLength(DELEGATION_HISTORY_MAX_ITEMS);
    const ids = items.map((d) => d.id);
    expect(ids).toContain("r-1");
    expect(ids).toContain("r-2");
    expect(ids).not.toContain("d-0");
    expect(ids).not.toContain("d-1");
  });

  it("persists every merge and a second store on the same storage reads it back", () => {
    const { storage } = memoryStorage();
    const a = createDelegationHistory({ storage, now: () => NOW });
    a.merge([running("a"), done("b", NOW - 60_000)]);

    const b = createDelegationHistory({ storage, now: () => NOW });
    expect(b.get().map((d) => d.id)).toEqual(["a", "b"]);

    a.merge([done("c", NOW - 30_000)]);
    b.reloadFromStorage();
    // a was closed by the second frame at NOW, so done-newest-first reads a, c, b.
    expect(b.get().map((d) => d.id)).toEqual(["a", "c", "b"]);
  });

  it("starts empty from a malformed stored value", () => {
    const { storage } = memoryStorage({ not: "a list" });
    const history = createDelegationHistory({ storage, now: () => NOW });
    expect(history.get()).toEqual([]);
  });

  it("keeps what it holds when storage reloads as garbage", () => {
    const { storage, set } = memoryStorage();
    const history = createDelegationHistory({ storage, now: () => NOW });
    history.merge([running("a")]);
    set([{ junk: true }]);
    history.reloadFromStorage();

    expect(history.get().map((d) => d.id)).toEqual(["a"]);
  });
});
