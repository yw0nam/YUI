/**
 * signals-inbox.test.ts — subscribe + unsubscribe lifecycle.
 *
 * Checks:
 *  - cb receives the payload when the channel emits
 *  - unsubscribe calls the underlying unlisten fn
 *  - cb is not called after unsubscribe
 *  - off-Tauri (no listen dep) returns a callable no-op that doesn't throw
 */

import { describe, expect, it, vi } from "vitest";
import { onSignalsInbox, type SignalsBatch } from "./signals-inbox";
import type { OsEventListen } from "./tauri-listen";

/** Fake `listen` that captures the handler so tests can emit payloads. */
function fakeListen() {
  let handler: ((e: { payload: unknown }) => void) | undefined;
  const unlisten = vi.fn();
  const listen = vi.fn(async (_event: string, h: (e: { payload: unknown }) => void) => {
    handler = h;
    return unlisten;
  }) as unknown as OsEventListen;
  return {
    listen,
    unlisten,
    emit(payload: SignalsBatch) {
      handler?.({ payload });
    },
  };
}

const SAMPLE: SignalsBatch = {
  signals: [{ kind: "reminder", payload: { foo: "bar" } }, { kind: "alert" }],
  envelope: {
    source: "n8n",
    event_type: "workflow_done",
    delivery: "immediate",
    event_id: "run-1",
    occurred_at: 1_787_449_000_000,
  },
  ts: 1_700_000_000_000,
};

describe("onSignalsInbox — payload delivery", () => {
  it("cb receives the payload emitted on the channel", async () => {
    const f = fakeListen();
    const cb = vi.fn();
    onSignalsInbox(cb, { listen: f.listen });
    // allow the async subscribe IIFE to resolve
    await Promise.resolve();
    await Promise.resolve();

    f.emit(SAMPLE);
    expect(cb).toHaveBeenCalledOnce();
    expect(cb.mock.calls[0][0]).toEqual(SAMPLE);
  });

  it("cb is not called after unsubscribe", async () => {
    const f = fakeListen();
    const cb = vi.fn();
    const unsub = onSignalsInbox(cb, { listen: f.listen });
    await Promise.resolve();
    await Promise.resolve();

    unsub();
    f.emit(SAMPLE);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("onSignalsInbox — unsubscribe", () => {
  it("unsubscribe calls the underlying unlisten fn", async () => {
    const f = fakeListen();
    const cb = vi.fn();
    const unsub = onSignalsInbox(cb, { listen: f.listen });
    await Promise.resolve();
    await Promise.resolve();

    unsub();
    expect(f.unlisten).toHaveBeenCalledOnce();
  });

  it("unsubscribe before subscribe resolves cancels cleanly without throwing", async () => {
    const f = fakeListen();
    const cb = vi.fn();
    const unsub = onSignalsInbox(cb, { listen: f.listen });
    // cancel before async subscribe settles
    expect(() => unsub()).not.toThrow();
    // let the IIFE settle — it must detect cancellation and call unlisten if needed
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // subsequent unsub calls are safe
    expect(() => unsub()).not.toThrow();
  });
});

describe("onSignalsInbox — off-Tauri degrade", () => {
  it("returns a callable no-op when no listen is provided (not in Tauri)", () => {
    // In test env, globalThis.__TAURI_INTERNALS__ is absent → resolveTauriListen returns undefined
    const cb = vi.fn();
    let unsub: (() => void) | undefined;
    expect(() => {
      unsub = onSignalsInbox(cb);
    }).not.toThrow();
    expect(typeof unsub).toBe("function");
    expect(() => unsub!()).not.toThrow();
  });

  it("cb is never called in off-Tauri mode", async () => {
    const cb = vi.fn();
    onSignalsInbox(cb);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(cb).not.toHaveBeenCalled();
  });
});
