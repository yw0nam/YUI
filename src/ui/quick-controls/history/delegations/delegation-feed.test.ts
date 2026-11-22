import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DelegationItem } from "../../../../io/chat/push/push-frames";
import { DELEGATION_REFRESH_MS } from "../../../chips/delegation-rows";
import { createDelegationFeed } from "./delegation-feed";

const RUNNING: DelegationItem = { id: "d-1", title: "work d-1", started_at: 0, state: "running" };

function build() {
  const log: string[] = [];
  let items: DelegationItem[] = [RUNNING];
  const listeners = new Set<() => void>();
  const feed = createDelegationFeed({
    get: () => items,
    subscribe(cb) {
      listeners.add(cb);
      return () => {
        log.push("unsub:delegations");
        listeners.delete(cb);
      };
    },
  });
  return {
    feed,
    log,
    listeners,
    notify(next: DelegationItem[]) {
      items = next;
      for (const cb of [...listeners]) cb();
    },
  };
}

/** Tracks the delegation refresh interval: whether one is live, and `clearInterval` in the log. */
function watchRefreshTimer(log: string[]): { armed(): boolean } {
  let handle: unknown;
  const realSet = globalThis.setInterval;
  vi.spyOn(globalThis, "setInterval").mockImplementation(((fn: () => void, ms?: number) => {
    const id = realSet(fn, ms);
    if (ms === DELEGATION_REFRESH_MS) handle = id;
    return id;
  }) as never);
  const realClear = globalThis.clearInterval;
  vi.spyOn(globalThis, "clearInterval").mockImplementation(((id?: never) => {
    if (id !== undefined && id === handle) {
      log.push("clearInterval");
      handle = undefined;
    }
    realClear(id);
  }) as never);
  return { armed: () => handle !== undefined };
}

describe("createDelegationFeed", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("dispose() releases the list and clears the refresh timer of a running item", () => {
    const { feed, log, listeners } = build();
    const timer = watchRefreshTimer(log);
    feed.sync();
    expect(timer.armed()).toBe(true);

    feed.dispose();

    expect(listeners.size).toBe(0);
    expect(timer.armed()).toBe(false);
  });

  it("dispose() unsubscribes the list before it clears the refresh timer", () => {
    const { feed, log } = build();
    watchRefreshTimer(log);
    feed.sync();
    log.length = 0;

    feed.dispose();

    expect(log).toEqual(["unsub:delegations", "clearInterval"]);
  });

  it("after dispose() no notification arms the refresh timer", () => {
    const { feed, log, notify } = build();
    const timer = watchRefreshTimer(log);

    feed.dispose();
    notify([RUNNING]);

    expect(timer.armed()).toBe(false);
  });
});
