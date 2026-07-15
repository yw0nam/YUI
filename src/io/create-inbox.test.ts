/**
 * create-inbox.test.ts — generic inbox lifecycle and degraded paths.
 *
 * Pins:
 *  - payload delivery stops after unsubscribe
 *  - subscribe rejection degrades to a safe unsubscribe
 *  - listen resolution failure degrades to a safe unsubscribe
 *  - cancellation during subscription cleans up the eventual listener
 */

import { describe, expect, it, vi } from "vitest";
import { createInbox } from "./create-inbox";
import type { OsEventListen } from "./tauri-listen";

vi.mock("./tauri-listen", () => ({
  resolveTauriListen: vi.fn(async () => {
    throw new Error("resolver unavailable");
  }),
}));

interface TestPayload {
  value: string;
}

/** Fake `listen` that captures the handler so tests can emit payloads. */
function createFakeListen() {
  let handler: ((e: { payload: unknown }) => void) | undefined;
  const unlisten = vi.fn();
  const listen = vi.fn(async (_event: string, h: (e: { payload: unknown }) => void) => {
    handler = h;
    return unlisten;
  }) as unknown as OsEventListen;
  return {
    listen,
    unlisten,
    emit(payload: TestPayload) {
      handler?.({ payload });
    },
  };
}

describe("createInbox — payload delivery", () => {
  it("delivers payloads until unsubscribed", async () => {
    const fake = createFakeListen();
    const cb = vi.fn();
    const unsubscribe = createInbox<TestPayload>("test_channel")(cb, {
      listen: fake.listen,
    });
    await Promise.resolve();
    await Promise.resolve();

    const payload = { value: "first" };
    fake.emit(payload);
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(payload);

    unsubscribe();
    fake.emit({ value: "second" });
    expect(cb).toHaveBeenCalledOnce();
  });
});

describe("createInbox — degraded subscriptions", () => {
  it("returns a safe unsubscribe when listen rejects", async () => {
    const listen = vi.fn(async () => {
      throw new Error("subscribe failed");
    }) as unknown as OsEventListen;
    const cb = vi.fn();
    const unsubscribe = createInbox<TestPayload>("test_channel")(cb, { listen });
    await Promise.resolve();
    await Promise.resolve();

    expect(cb).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
  });

  it("returns a safe unsubscribe when listen resolution rejects", async () => {
    const cb = vi.fn();
    const unsubscribe = createInbox<TestPayload>("test_channel")(cb);
    await Promise.resolve();
    await Promise.resolve();

    expect(cb).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
  });
});

describe("createInbox — pending subscription cancellation", () => {
  it("unlistens when subscribe resolves after cancellation", async () => {
    let handler: ((e: { payload: unknown }) => void) | undefined;
    let resolveListen: ((unlisten: () => void) => void) | undefined;
    const unlisten = vi.fn();
    const listen = vi.fn((_event: string, h: (e: { payload: unknown }) => void) => {
      handler = h;
      return new Promise<() => void>((resolve) => {
        resolveListen = resolve;
      });
    }) as unknown as OsEventListen;
    const cb = vi.fn();
    const unsubscribe = createInbox<TestPayload>("test_channel")(cb, { listen });

    unsubscribe();
    resolveListen?.(unlisten);
    await Promise.resolve();
    await Promise.resolve();

    expect(unlisten).toHaveBeenCalledOnce();
    handler?.({ payload: { value: "late" } });
    expect(cb).not.toHaveBeenCalled();
  });
});
