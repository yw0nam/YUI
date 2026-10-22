import { describe, expect, it } from "vitest";
import { fakeLocks } from "../../locks/fake-lock-manager";
import { createVoiceGate } from "./voice-gate";

const tick = () => new Promise((r) => setTimeout(r, 0));

function track(p: Promise<void>) {
  const state = { resolved: false };
  void p.then(() => {
    state.resolved = true;
  });
  return state;
}

describe("createVoiceGate", () => {
  it("takes a free lock at once and hands it to the next window on release", async () => {
    const { locks } = fakeLocks();
    const first = createVoiceGate({ enabled: () => true, locks });
    const second = createVoiceGate({ enabled: () => true, locks });

    const a = track(first.acquire(new AbortController().signal));
    const b = track(second.acquire(new AbortController().signal));
    await tick();
    expect([a.resolved, b.resolved]).toEqual([true, false]);

    first.release();
    await tick();
    expect(b.resolved).toBe(true);
  });

  it("resolves without taking the lock when the switch is off", async () => {
    const { locks, request } = fakeLocks();
    const gate = createVoiceGate({ enabled: () => false, locks });

    const a = track(gate.acquire(new AbortController().signal));
    await tick();
    expect(a.resolved).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });

  it("an abort while waiting resolves without holding, and the next waiter gets the lock", async () => {
    const { locks } = fakeLocks();
    const holder = createVoiceGate({ enabled: () => true, locks });
    const aborted = createVoiceGate({ enabled: () => true, locks });
    const next = createVoiceGate({ enabled: () => true, locks });
    const controller = new AbortController();

    await holder.acquire(new AbortController().signal);
    const b = track(aborted.acquire(controller.signal));
    const c = track(next.acquire(new AbortController().signal));
    controller.abort();
    await tick();
    expect([b.resolved, c.resolved]).toEqual([true, false]);

    holder.release();
    await tick();
    expect(c.resolved).toBe(true);
  });

  it("a grant delivered after the abort resolves acquire and frees the lock without release", async () => {
    const { locks, isHeld } = fakeLocks({ grantAfterAbort: true });
    const holder = createVoiceGate({ enabled: () => true, locks });
    const late = createVoiceGate({ enabled: () => true, locks });
    const controller = new AbortController();

    await holder.acquire(new AbortController().signal);
    const b = track(late.acquire(controller.signal));
    controller.abort();
    holder.release();
    await tick();
    expect(b.resolved).toBe(true);
    expect(isHeld()).toBe(false);
  });
});
