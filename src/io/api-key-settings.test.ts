/**
 * api-key-settings.test.ts — generic API-key override store.
 *
 * createApiKeySettings({ storageKey, maxLen? }) backs chat/stt/tts key stores.
 * "" = no override. Values are trimmed, length-capped, and never logged.
 */

import { describe, expect, it } from "vitest";
import { createApiKeySettings } from "./api-key-settings";
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

  it("caps length at maxLen", () => {
    const s = createApiKeySettings({ storageKey: "k", maxLen: 5 });
    s.setApiKey("0123456789");
    expect(s.get().apiKey).toBe("01234");
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
});

describe("createChatKeySettings — unchanged behavior over the generic factory", () => {
  it("get/set/clear behave identically to the generic store", () => {
    const chat = createChatKeySettings();
    expect(chat.get().apiKey).toBe("");
    chat.setApiKey("  sk-chat ");
    expect(chat.get().apiKey).toBe("sk-chat");
    chat.clear();
    expect(chat.get().apiKey).toBe("");
  });
});
