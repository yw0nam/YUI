/**
 * avatar-rpc.test.ts — the `avatar-rpc` request channel + the response invoke.
 *
 * Checks:
 *  - cb receives the request emitted on the channel
 *  - unsubscribe stops delivery
 *  - respondAvatarRpc forwards id + result to the Tauri command
 *  - off-Tauri (no invoke dep) degrades silently instead of throwing
 */

import { describe, expect, it, vi } from "vitest";
import { type AvatarRpcRequest, onAvatarRpc, respondAvatarRpc } from "./avatar-rpc";
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
    emit(payload: AvatarRpcRequest) {
      handler?.({ payload });
    },
  };
}

const SAMPLE: AvatarRpcRequest = {
  id: "1700000000000-3",
  method: "command",
  params: { action: "peek", side: "left" },
};

describe("onAvatarRpc", () => {
  it("cb receives the request emitted on the channel", async () => {
    const f = fakeListen();
    const cb = vi.fn();
    onAvatarRpc(cb, { listen: f.listen });
    await Promise.resolve();
    await Promise.resolve();

    f.emit(SAMPLE);

    expect(cb).toHaveBeenCalledOnce();
    expect(cb.mock.calls[0][0]).toEqual(SAMPLE);
  });

  it("cb is not called after unsubscribe", async () => {
    const f = fakeListen();
    const cb = vi.fn();
    const unsub = onAvatarRpc(cb, { listen: f.listen });
    await Promise.resolve();
    await Promise.resolve();

    unsub();
    f.emit(SAMPLE);

    expect(cb).not.toHaveBeenCalled();
  });

  it("returns a callable no-op off-Tauri", () => {
    const cb = vi.fn();
    let unsub: (() => void) | undefined;
    expect(() => {
      unsub = onAvatarRpc(cb);
    }).not.toThrow();
    expect(() => unsub!()).not.toThrow();
  });
});

describe("respondAvatarRpc", () => {
  it("forwards the id and result to the avatar_rpc_response command", async () => {
    const invoke = vi.fn(async () => undefined);

    await respondAvatarRpc("abc", { ok: true }, { invoke });

    expect(invoke).toHaveBeenCalledWith("avatar_rpc_response", {
      id: "abc",
      result: { ok: true },
    });
  });

  it("degrades silently when the command rejects", async () => {
    const invoke = vi.fn(async () => {
      throw new Error("no such command");
    });

    await expect(respondAvatarRpc("abc", { ok: true }, { invoke })).resolves.toBeUndefined();
  });

  it("degrades silently off-Tauri", async () => {
    await expect(respondAvatarRpc("abc", { ok: true })).resolves.toBeUndefined();
  });
});
