/**
 * agent-inbox.test.ts — subscribe + unsubscribe lifecycle.
 *
 * Checks:
 *  - cb receives the payload when the channel emits
 *  - unsubscribe calls the underlying unlisten fn
 *  - cb is not called after unsubscribe
 *  - off-Tauri (no listen dep) returns a callable no-op that doesn't throw
 */

import { describe, expect, it, vi } from "vitest";
import { type AgentEvent, onAgentInbox } from "./agent-inbox";
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
    emit(payload: AgentEvent) {
      handler?.({ payload });
    },
  };
}

const SAMPLE: AgentEvent = {
  tool: "build",
  project: "my-project",
  cwd: "/home/user/project",
  status: "success",
  phase: "done",
  summary: "Build completed",
  ts: 1_700_000_000_000,
};

describe("onAgentInbox — payload delivery", () => {
  it("cb receives the payload emitted on the channel", async () => {
    const f = fakeListen();
    const cb = vi.fn();
    onAgentInbox(cb, { listen: f.listen });
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
    const unsub = onAgentInbox(cb, { listen: f.listen });
    await Promise.resolve();
    await Promise.resolve();

    unsub();
    f.emit(SAMPLE);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("onAgentInbox — unsubscribe", () => {
  it("unsubscribe calls the underlying unlisten fn", async () => {
    const f = fakeListen();
    const cb = vi.fn();
    const unsub = onAgentInbox(cb, { listen: f.listen });
    await Promise.resolve();
    await Promise.resolve();

    unsub();
    expect(f.unlisten).toHaveBeenCalledOnce();
  });

  it("unsubscribe before subscribe resolves cancels cleanly without throwing", async () => {
    const f = fakeListen();
    const cb = vi.fn();
    const unsub = onAgentInbox(cb, { listen: f.listen });
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

describe("onAgentInbox — off-Tauri degrade", () => {
  it("returns a callable no-op when no listen is provided (not in Tauri)", () => {
    // In test env, globalThis.__TAURI_INTERNALS__ is absent → resolveTauriListen returns undefined
    const cb = vi.fn();
    let unsub: (() => void) | undefined;
    expect(() => {
      unsub = onAgentInbox(cb);
    }).not.toThrow();
    expect(typeof unsub).toBe("function");
    expect(() => unsub!()).not.toThrow();
  });

  it("cb is never called in off-Tauri mode", async () => {
    const cb = vi.fn();
    onAgentInbox(cb);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(cb).not.toHaveBeenCalled();
  });
});
