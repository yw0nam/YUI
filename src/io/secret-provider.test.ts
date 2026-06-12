/**
 * secret-provider.test.ts — TDD red for the runtime SecretProvider.
 *
 * Pins the contract for src/io/secret-provider.ts:
 *   createSettingsSecretProvider({ chatKey, fallback? }) → SecretProvider
 *
 * Resolution rule for CHAT_API_KEY_SECRET: runtime store (non-empty) → fallback → undefined.
 * For any other name: fallback lookup only. The key value is a secret — never logged.
 */

import { describe, expect, it, vi } from "vitest";
import { CHAT_API_KEY_SECRET } from "../config";
import { createChatKeySettings } from "./chat-key-settings";
import { createSettingsSecretProvider } from "./secret-provider";

describe("createSettingsSecretProvider — chat key resolution", () => {
  it("returns the runtime key when the store has a non-empty value", async () => {
    const chatKey = createChatKeySettings();
    chatKey.setApiKey("sk-runtime");
    const provider = createSettingsSecretProvider({ chatKey });
    expect(await provider.get(CHAT_API_KEY_SECRET)).toBe("sk-runtime");
  });

  it("runtime key wins over fallback", async () => {
    const chatKey = createChatKeySettings();
    chatKey.setApiKey("sk-runtime");
    const provider = createSettingsSecretProvider({
      chatKey,
      fallback: { [CHAT_API_KEY_SECRET]: "sk-build" },
    });
    expect(await provider.get(CHAT_API_KEY_SECRET)).toBe("sk-runtime");
  });

  it("falls back to the build-time key when the store is empty", async () => {
    const chatKey = createChatKeySettings();
    const provider = createSettingsSecretProvider({
      chatKey,
      fallback: { [CHAT_API_KEY_SECRET]: "sk-build" },
    });
    expect(await provider.get(CHAT_API_KEY_SECRET)).toBe("sk-build");
  });

  it("returns undefined when both store and fallback are empty", async () => {
    const chatKey = createChatKeySettings();
    const provider = createSettingsSecretProvider({ chatKey });
    expect(await provider.get(CHAT_API_KEY_SECRET)).toBeUndefined();
  });

  it("reflects a runtime change made after construction", async () => {
    const chatKey = createChatKeySettings();
    const provider = createSettingsSecretProvider({
      chatKey,
      fallback: { [CHAT_API_KEY_SECRET]: "sk-build" },
    });
    expect(await provider.get(CHAT_API_KEY_SECRET)).toBe("sk-build");
    chatKey.setApiKey("sk-runtime");
    expect(await provider.get(CHAT_API_KEY_SECRET)).toBe("sk-runtime");
    chatKey.clear();
    expect(await provider.get(CHAT_API_KEY_SECRET)).toBe("sk-build");
  });
});

describe("createSettingsSecretProvider — unrelated names", () => {
  it("returns the fallback value for an unrelated name", async () => {
    const chatKey = createChatKeySettings();
    const provider = createSettingsSecretProvider({
      chatKey,
      fallback: { other_secret: "v" },
    });
    expect(await provider.get("other_secret")).toBe("v");
  });

  it("returns undefined for an unrelated name absent from fallback", async () => {
    const chatKey = createChatKeySettings();
    chatKey.setApiKey("sk-runtime");
    const provider = createSettingsSecretProvider({ chatKey });
    expect(await provider.get("other_secret")).toBeUndefined();
  });

  it("does not consult the chat-key store for unrelated names", async () => {
    const chatKey = createChatKeySettings();
    chatKey.setApiKey("sk-runtime");
    const getSpy = vi.spyOn(chatKey, "get");
    const provider = createSettingsSecretProvider({ chatKey });
    await provider.get("other_secret");
    expect(getSpy).not.toHaveBeenCalled();
  });
});

describe("createSettingsSecretProvider — async SecretProvider shape", () => {
  it("get() returns a promise", () => {
    const chatKey = createChatKeySettings();
    const provider = createSettingsSecretProvider({ chatKey });
    const result = provider.get(CHAT_API_KEY_SECRET);
    expect(result).toBeInstanceOf(Promise);
  });

  it("never throws for any name", async () => {
    const chatKey = createChatKeySettings();
    const provider = createSettingsSecretProvider({ chatKey });
    await expect(provider.get(CHAT_API_KEY_SECRET)).resolves.toBeUndefined();
    await expect(provider.get("anything")).resolves.toBeUndefined();
  });
});
