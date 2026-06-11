/**
 * motion-finish-waiters.test.ts — id-keyed clean-finish waiters (#143 wiring).
 *
 * The renderer resolves a fall-sequence `whenMotionFinished(id)` only when the
 * mixer reports that exact clip finished naturally. A consumed finish tells the
 * caller (onMixerFinished) to skip the controller auto-swap — the awaiting fall
 * controller owns the follow-up motion (sole-driver, must-fix #3). A cut/replaced
 * clip never resolves a waiter: resolve() is only invoked from the natural-finish
 * path, and clear() (teardown/hotswap) drops pending waiters without settling.
 */

import { describe, it, expect, vi } from "vitest";
import { createMotionFinishWaiters } from "./motion-finish-waiters";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("createMotionFinishWaiters", () => {
  it("wait(id) resolves when resolve(id) fires, and resolve reports consumption", async () => {
    const w = createMotionFinishWaiters();
    const done = vi.fn();
    void w.wait("landing").then(done);

    expect(w.resolve("landing")).toBe(true);
    await flush();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("resolve(id) with no waiters returns false (auto-swap proceeds)", () => {
    const w = createMotionFinishWaiters();
    expect(w.resolve("landing")).toBe(false);
  });

  it("a different id never settles the waiter (no spurious resolve)", async () => {
    const w = createMotionFinishWaiters();
    const done = vi.fn();
    void w.wait("landing").then(done);

    expect(w.resolve("suneru")).toBe(false);
    await flush();
    expect(done).not.toHaveBeenCalled();
  });

  it("multiple waiters on the same id all resolve on one finish", async () => {
    const w = createMotionFinishWaiters();
    const a = vi.fn();
    const b = vi.fn();
    void w.wait("landing").then(a);
    void w.wait("landing").then(b);

    expect(w.resolve("landing")).toBe(true);
    await flush();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("waiters are consumed: a second resolve(id) returns false", async () => {
    const w = createMotionFinishWaiters();
    void w.wait("landing");
    expect(w.resolve("landing")).toBe(true);
    expect(w.resolve("landing")).toBe(false);
  });

  it("clear() drops pending waiters without settling them", async () => {
    const w = createMotionFinishWaiters();
    const done = vi.fn();
    void w.wait("landing").then(done);

    w.clear();
    expect(w.resolve("landing")).toBe(false);
    await flush();
    expect(done).not.toHaveBeenCalled();
  });
});
