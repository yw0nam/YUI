// @vitest-environment jsdom
/**
 * back-button.test.ts — the Android back claim: registered only while a surface holds it,
 * unregistered on release, serialized across races, and failing safe on a rejected registration.
 */
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import { type BackButtonRegister, createBackButtonClaim } from "./back-button";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

interface PendingRegistration {
  cb: () => void;
  resolve: (unlisten: () => void) => void;
  reject: (error: unknown) => void;
}

/** A register whose promises the test settles by hand, in call order. */
function fakeRegister(): { register: BackButtonRegister; calls: PendingRegistration[] } {
  const calls: PendingRegistration[] = [];
  return {
    calls,
    register: (cb) =>
      new Promise<() => void>((resolve, reject) => {
        calls.push({ cb, resolve, reject });
      }),
  };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("createBackButtonClaim", () => {
  it("rapid open/close/open leaves exactly one live listener", async () => {
    const fake = fakeRegister();
    const claim = createBackButtonClaim(fake.register);
    const first: Mock<() => void> = vi.fn();
    const second: Mock<() => void> = vi.fn();
    const unlistens = [
      vi.fn<() => Promise<void>>(() => Promise.resolve()),
      vi.fn<() => Promise<void>>(() => Promise.resolve()),
    ];

    claim.claim(first);
    claim.release();
    claim.claim(second);
    await flush();
    expect(fake.calls).toHaveLength(1);

    fake.calls[0].resolve(unlistens[0]);
    await flush();
    // The release unregisters the first registration; the second claim then registers anew.
    expect(unlistens[0]).toHaveBeenCalledTimes(1);
    expect(fake.calls).toHaveLength(2);

    fake.calls[1].resolve(unlistens[1]);
    await flush();
    // A stale delivery from the first registration routes to the live handler, never the old one.
    fake.calls[0].cb();
    fake.calls[1].cb();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(2);

    claim.release();
    await flush();
    expect(unlistens[1]).toHaveBeenCalledTimes(1);
    claim.dispose();
  });

  it("a claim during a pending release waits for the unregister to settle", async () => {
    const fake = fakeRegister();
    const claim = createBackButtonClaim(fake.register);
    let settleUnlisten: () => void = () => {};
    const unregistering = new Promise<void>((resolve) => {
      settleUnlisten = resolve;
    });

    claim.claim(() => {});
    await flush();
    // The registration resolves with an unlisten whose promise the test holds.
    fake.calls[0].resolve(() => unregistering);
    await flush();

    claim.release();
    claim.claim(() => {});
    await flush();
    // The unregister is still pending — no new registration yet.
    expect(fake.calls).toHaveLength(1);

    settleUnlisten();
    await flush();
    expect(fake.calls).toHaveLength(2);

    claim.dispose();
  });

  it("a rejected registration is logged and later claims retry", async () => {
    const fake = fakeRegister();
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const claim = createBackButtonClaim(fake.register, log);

    claim.claim(() => {});
    await flush();
    fake.calls[0].reject(new Error("plugin unavailable"));
    await flush();
    expect(log.warn).toHaveBeenCalledTimes(1);

    // Releasing a claim whose registration failed settles cleanly…
    claim.release();
    await flush();
    // …and the next claim registers again.
    claim.claim(() => {});
    await flush();
    expect(fake.calls).toHaveLength(2);
    fake.calls[1].resolve(() => {});
    await flush();
    claim.release();
    await flush();

    claim.dispose();
  });
});
