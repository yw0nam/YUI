/**
 * avatar-rpc.test.ts — the `avatar-rpc` request channel + the response invoke.
 *
 * The inbox lifecycle (payload delivery, unsubscribe, cancel-before-resolve,
 * off-Tauri no-op) belongs to the generic factory and is pinned in
 * create-inbox.test.ts. Specific here: the Tauri event name, and that
 * respondAvatarRpc forwards id + result to the Tauri command without throwing.
 */

import { describe, expect, it, vi } from "vitest";
import { onAvatarRpc, respondAvatarRpc } from "./avatar-rpc";
import type { OsEventListen } from "./tauri-listen";

describe("onAvatarRpc", () => {
  it("subscribes to the `avatar-rpc` Tauri event channel", async () => {
    const listen = vi.fn(async () => vi.fn()) as unknown as OsEventListen;

    onAvatarRpc(vi.fn(), { listen });
    await Promise.resolve();
    await Promise.resolve();

    expect(listen).toHaveBeenCalledWith("avatar-rpc", expect.any(Function));
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
