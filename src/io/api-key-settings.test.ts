/**
 * api-key-settings.test.ts — generic API-key override store.
 *
 * createApiKeySettings({ storageKey }) backs chat/stt/tts key stores.
 * "" = no override. Values are trimmed, length-capped, and never logged.
 */

import { describe, expect, it, vi } from "vitest";
import { API_KEY_MAX_LEN, createApiKeySettings } from "./api-key-settings";
import { createChatKeySettings } from "./chat-key-settings";

describe("createApiKeySettings", () => {
  it("defaults to an empty key (no override)", () => {
    expect(createApiKeySettings({ storageKey: "k" }).get().apiKey).toBe("");
  });

  it("setApiKey trims and stores", () => {
    const s = createApiKeySettings({ storageKey: "k" });
    s.setApiKey("  sk-abc  ");
    expect(s.get().apiKey).toBe("sk-abc");
  });

  it("clear() returns to no override", () => {
    const s = createApiKeySettings({ storageKey: "k" });
    s.setApiKey("sk-abc");
    s.clear();
    expect(s.get().apiKey).toBe("");
  });

  it("caps length at API_KEY_MAX_LEN", () => {
    const s = createApiKeySettings({ storageKey: "k" });
    s.setApiKey("0".repeat(API_KEY_MAX_LEN + 5000));
    expect(s.get().apiKey.length).toBe(API_KEY_MAX_LEN);
  });

  it("notifies subscribers on change", () => {
    const s = createApiKeySettings({ storageKey: "k" });
    let seen = "";
    s.subscribe(() => {
      seen = s.get().apiKey;
    });
    s.setApiKey("sk-xyz");
    expect(seen).toBe("sk-xyz");
  });

  it("ignores non-string input — the key stays empty and no subscriber is notified", () => {
    const s = createApiKeySettings({ storageKey: "k" });
    const cb = vi.fn();
    s.subscribe(cb);
    s.setApiKey(123 as unknown as string);
    expect(s.get().apiKey).toBe("");
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("createChatKeySettings — unchanged behavior over the generic factory", () => {
  it("get/set/clear behave identically to the generic store, capped at API_KEY_MAX_LEN", () => {
    const chat = createChatKeySettings();
    expect(chat.get().apiKey).toBe("");
    chat.setApiKey("  sk-chat ");
    expect(chat.get().apiKey).toBe("sk-chat");
    chat.setApiKey("x".repeat(API_KEY_MAX_LEN + 5000));
    expect(chat.get().apiKey.length).toBe(API_KEY_MAX_LEN);
    chat.clear();
    expect(chat.get().apiKey).toBe("");
  });
});
