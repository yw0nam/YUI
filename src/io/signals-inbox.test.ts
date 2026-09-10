/**
 * signals-inbox.test.ts — channel binding.
 *
 * The inbox lifecycle (payload delivery, unsubscribe, cancel-before-resolve,
 * off-Tauri no-op) belongs to the generic factory and is pinned in
 * create-inbox.test.ts. What is specific here is the Tauri event name.
 */

import { describe, expect, it, vi } from "vitest";
import { onSignalsInbox } from "./signals-inbox";
import type { OsEventListen } from "./tauri-listen";

describe("onSignalsInbox", () => {
  it("subscribes to the `signals-inbox` Tauri event channel", async () => {
    const listen = vi.fn(async () => vi.fn()) as unknown as OsEventListen;

    onSignalsInbox(vi.fn(), { listen });
    await Promise.resolve();
    await Promise.resolve();

    expect(listen).toHaveBeenCalledWith("signals-inbox", expect.any(Function));
  });
});
