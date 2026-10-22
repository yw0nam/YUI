import { describe, expect, it, vi } from "vitest";
import { fakeLocks } from "../../io/locks/fake-lock-manager";
import { createTurnGate } from "./turn-gate";

const tick = () => new Promise((r) => setTimeout(r, 0));

function makeGate(over: Partial<Parameters<typeof createTurnGate>[0]> = {}) {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const gate = createTurnGate({ enabled: () => true, logger, ...over });
  return { gate, logger };
}

describe("createTurnGate", () => {
  it.each([
    { name: "the switch is off", enabled: false, aborted: false },
    { name: "the signal is already aborted", enabled: true, aborted: true },
  ])("resolves without a lock request when $name", async ({ enabled, aborted }) => {
    const { locks, request } = fakeLocks();
    const { gate } = makeGate({ enabled: () => enabled, locks });
    const controller = new AbortController();
    if (aborted) controller.abort();

    await gate.acquire(controller.signal);

    expect(request).not.toHaveBeenCalled();
  });

  it("takes a free lock with one ifAvailable request and logs no hold", async () => {
    const { locks, request, isHeld } = fakeLocks();
    const { gate, logger } = makeGate({ locks });

    await gate.acquire(new AbortController().signal);

    expect(request.mock.calls.map(([name, options]) => [name, options])).toEqual([
      ["yui.turn", { ifAvailable: true }],
    ]);
    expect(isHeld()).toBe(true);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("logs turn_hold when the lock is taken, then turn_granted with the wait once granted", async () => {
    const { locks, freeOther } = fakeLocks({ heldByOther: true });
    const times = [1_000, 1_250];
    const { gate, logger } = makeGate({ locks, now: () => times.shift() ?? 0 });
    let granted = false;

    void gate.acquire(new AbortController().signal).then(() => {
      granted = true;
    });
    await tick();
    expect(logger.info.mock.calls).toEqual([["turn_hold", {}]]);
    expect(granted).toBe(false);

    freeOther();
    await tick();
    expect(granted).toBe(true);
    expect(logger.info.mock.calls).toEqual([
      ["turn_hold", {}],
      ["turn_granted", { waited_ms: 250 }],
    ]);
  });

  it("an abort while waiting resolves without holding, and release is a no-op", async () => {
    const { locks, freeOther, isHeld } = fakeLocks({ heldByOther: true });
    const { gate } = makeGate({ locks });
    const controller = new AbortController();
    let resolved = false;

    void gate.acquire(controller.signal).then(() => {
      resolved = true;
    });
    await tick();
    controller.abort();
    await tick();
    expect(resolved).toBe(true);

    freeOther();
    gate.release();
    await tick();
    expect(isHeld()).toBe(false);
  });

  it("release frees the lock for the next window", async () => {
    const { locks, isHeld } = fakeLocks();
    const { gate } = makeGate({ locks });

    await gate.acquire(new AbortController().signal);
    gate.release();
    await tick();

    expect(isHeld()).toBe(false);
  });

  it("a second acquire while this window holds the lock resolves without another request", async () => {
    const { locks, request } = fakeLocks();
    const { gate } = makeGate({ locks });

    await gate.acquire(new AbortController().signal);
    await gate.acquire(new AbortController().signal);

    expect(request).toHaveBeenCalledOnce();
  });

  it("a holder's later abort does not drop another window's queued request", async () => {
    const { locks, freeOther } = fakeLocks({ heldByOther: true });
    const controller = new AbortController();
    const first = makeGate({ locks }).gate;
    const second = makeGate({ locks }).gate;
    const third = makeGate({ locks }).gate;
    const granted: string[] = [];

    void first.acquire(controller.signal).then(() => granted.push("first"));
    void second.acquire(new AbortController().signal).then(() => granted.push("second"));
    void third.acquire(new AbortController().signal).then(() => granted.push("third"));
    await tick();
    freeOther();
    await tick();
    controller.abort();
    first.release();
    await tick();
    second.release();
    await tick();

    expect(granted).toEqual(["first", "second", "third"]);
  });
});
