import { describe, expect, it, vi } from "vitest";
import { createTurnGate } from "./turn-gate";

type Options = { ifAvailable?: boolean; signal?: AbortSignal };

/** One exclusive lock: `ifAvailable` answers null while held; a queued request is granted in order and honours `signal`. */
function fakeLocks(opts: { heldByOther?: boolean } = {}) {
  let held = opts.heldByOther ?? false;
  const waiting: Array<() => void> = [];
  const next = () => {
    held = false;
    waiting.shift()?.();
  };
  const request = vi.fn(
    (
      _name: string,
      options: Options,
      callback: (lock: object | null) => Promise<void> | undefined,
    ) =>
      new Promise<void>((resolve, reject) => {
        const grant = () => {
          held = true;
          Promise.resolve(callback({})).then(resolve, reject).finally(next);
        };
        if (options.ifAvailable) {
          if (held) resolve(void callback(null));
          else grant();
          return;
        }
        options.signal?.addEventListener(
          "abort",
          () => {
            waiting.splice(waiting.indexOf(grant), 1);
            reject(new DOMException("aborted", "AbortError"));
          },
          { once: true },
        );
        if (held) waiting.push(grant);
        else grant();
      }),
  );
  return {
    locks: { request } as unknown as Pick<LockManager, "request">,
    request,
    isHeld: () => held,
    freeOther: next,
  };
}

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

  it("logs turn_hold when the lock is taken, then turn_release with the wait once granted", async () => {
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
      ["turn_release", { held_ms: 250 }],
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
});
