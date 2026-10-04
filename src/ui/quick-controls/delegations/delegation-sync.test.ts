import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DelegationItem } from "../../../io/chat/push-socket";
import { DELEGATION_REFRESH_MS } from "../../chips/delegation-rows";
import { createDelegationSync } from "./delegation-sync";

const RUNNING: DelegationItem = { id: "d-1", title: "work", started_at: 0, state: "running" };
const DONE: DelegationItem = {
  id: "d-1",
  title: "work",
  started_at: 0,
  state: "done",
  ended_at: 1,
};

function setup(initial: DelegationItem[] | null) {
  const calls: string[] = [];
  let items = initial ?? [];
  const delegations =
    initial === null
      ? undefined
      : {
          get: () => items,
          refresh: vi.fn(() => {
            calls.push("refresh");
          }),
        };
  const reflectDelegations = vi.fn(() => {
    calls.push("reflect");
  });
  const sync = createDelegationSync({ delegations, reflectDelegations });
  return {
    sync,
    calls,
    delegations,
    reflectDelegations,
    setItems(next: DelegationItem[]) {
      items = next;
    },
  };
}

describe("createDelegationSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("only redraws when no delegations list is given", () => {
    const { sync, reflectDelegations } = setup(null);

    sync.sync();

    expect(reflectDelegations).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("redraws, then arms one interval for a running item however often it syncs", () => {
    const { sync, calls } = setup([RUNNING]);

    sync.sync();
    sync.sync();

    expect(calls).toEqual(["reflect", "reflect"]);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("does not arm for a list without a running item", () => {
    const { sync } = setup([DONE]);

    sync.sync();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("on each tick refreshes the list, then redraws, without rechecking for running items", () => {
    const { sync, calls, setItems } = setup([RUNNING]);
    sync.sync();
    calls.length = 0;
    setItems([DONE]);

    vi.advanceTimersByTime(DELEGATION_REFRESH_MS * 2);

    expect(calls).toEqual(["refresh", "reflect", "refresh", "reflect"]);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("clears the interval when the last running item finishes, and arms again for a new one", () => {
    const { sync, setItems } = setup([RUNNING]);
    sync.sync();
    setItems([DONE]);
    sync.sync();
    expect(vi.getTimerCount()).toBe(0);

    setItems([RUNNING]);
    sync.sync();

    expect(vi.getTimerCount()).toBe(1);
  });

  describe("stop", () => {
    it("clears a pending interval", () => {
      const { sync } = setup([RUNNING]);
      sync.sync();

      sync.stop();

      expect(vi.getTimerCount()).toBe(0);
    });

    it("keeps the handle, so a later running sync does not arm again", () => {
      const { sync } = setup([RUNNING]);
      sync.sync();
      sync.stop();

      sync.sync();

      expect(vi.getTimerCount()).toBe(0);
    });

    it("lets a sync with nothing running forget the stopped handle, so arming works again", () => {
      const { sync, setItems } = setup([RUNNING]);
      sync.sync();
      sync.stop();
      setItems([DONE]);
      sync.sync();

      setItems([RUNNING]);
      sync.sync();

      expect(vi.getTimerCount()).toBe(1);
    });
  });
});
