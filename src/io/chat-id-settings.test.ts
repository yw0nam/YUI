/**
 * chat-id-settings.test.ts — the per-installation conversation id the push transport
 * identifies itself with (`hello.chat_id`).
 */

import { describe, expect, it } from "vitest";
import {
  type ChatIdStorage,
  createChatIdSettings,
  localStorageChatIdStorage,
} from "./chat-id-settings";

function inMemoryStorage(initial?: string): ChatIdStorage & { saved: string | null } {
  let stored: string | null = initial ?? null;
  return {
    saved: null,
    load: () => stored,
    save(s) {
      stored = s;
      this.saved = s;
    },
  };
}

describe("createChatIdSettings", () => {
  it("generates yui- + 8 lowercase hex chars on first read and persists it", () => {
    const storage = inMemoryStorage();
    const settings = createChatIdSettings({ storage });

    const id = settings.get().chat_id;
    expect(id).toMatch(/^yui-[0-9a-f]{8}$/);
    expect(storage.saved).toBe(id);
  });

  it("reuses the stored id on the next read", () => {
    const settings = createChatIdSettings({ storage: inMemoryStorage("yui-3f9a2c1d") });
    expect(settings.get().chat_id).toBe("yui-3f9a2c1d");
  });

  it("regenerates when the stored value is not a well-formed id", () => {
    const storage = inMemoryStorage("not-an-id");
    const settings = createChatIdSettings({ storage });
    expect(settings.get().chat_id).toMatch(/^yui-[0-9a-f]{8}$/);
    expect(storage.saved).toBe(settings.get().chat_id);
  });

  it("two stores over one storage share the id", () => {
    const storage = inMemoryStorage();
    const first = createChatIdSettings({ storage }).get().chat_id;
    const second = createChatIdSettings({ storage }).get().chat_id;
    expect(second).toBe(first);
  });

  it("localStorageChatIdStorage round-trips under the yui.chat-id key", () => {
    const cells = new Map<string, string>();
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: (k: string) => cells.get(k) ?? null,
      setItem: (k: string, v: string) => cells.set(k, v),
    };

    const store = localStorageChatIdStorage();
    store.save("yui-0a1b2c3d");
    expect(cells.has("yui.chat-id")).toBe(true);
    expect(store.load()).toBe("yui-0a1b2c3d");

    delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
  });
});
