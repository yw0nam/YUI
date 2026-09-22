/**
 * chat-key-settings.test.ts — what the chat key adds over the generic api-key store.
 *
 * The store behavior (trim, length cap, clear, notify, persistence) belongs to the
 * generic factory and is pinned in api-key-settings.test.ts. Chat-specific here:
 * the localStorage key the adapter writes under.
 */

import { describe, expect, it } from "vitest";
import { localStorageChatKeyStorage } from "./chat-key-settings";

describe("localStorageChatKeyStorage", () => {
  it("default key is 'yui.chat-key'", () => {
    const written: Array<[string, string]> = [];
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => null,
      setItem: (k: string, v: string) => written.push([k, v]),
    };

    const adapter = localStorageChatKeyStorage();
    adapter.save({ apiKey: "sk-test" });
    expect(written[0][0]).toBe("yui.chat-key");

    delete (globalThis as { localStorage?: unknown }).localStorage;
  });
});
