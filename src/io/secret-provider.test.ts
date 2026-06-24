/**
 * secret-provider.test.ts — runtime SecretProvider.
 *
 * Pins the contract for src/io/secret-provider.ts:
 *   createSettingsSecretProvider({ stores, fallback? }) → SecretProvider
 *
 * Resolution rule per secret name: matching runtime store (non-empty) → fallback → undefined.
 * Names without a store fall straight to fallback. Empty/whitespace fallback → undefined.
 * The key value is a secret — never logged.
 */

import { describe, expect, it, vi } from "vitest";
import { CHAT_API_KEY_SECRET, STT_API_KEY_SECRET, TTS_API_KEY_SECRET } from "../config";
import { createApiKeySettings } from "./api-key-settings";
import { createChatKeySettings } from "./chat-key-settings";
import { createSettingsSecretProvider } from "./secret-provider";

const store = () => createApiKeySettings({ storageKey: "test" });

describe("createSettingsSecretProvider — store-first resolution", () => {
  it("returns the runtime key when the store has a non-empty value", async () => {
    const chatKey = createChatKeySettings();
    chatKey.setApiKey("sk-runtime");
    const provider = createSettingsSecretProvider({ stores: { [CHAT_API_KEY_SECRET]: chatKey } });
    expect(await provider.get(CHAT_API_KEY_SECRET)).toBe("sk-runtime");
  });

  it("runtime key wins over fallback", async () => {
    const chatKey = createChatKeySettings();
    chatKey.setApiKey("sk-runtime");
    const provider = createSettingsSecretProvider({
      stores: { [CHAT_API_KEY_SECRET]: chatKey },
      fallback: { [CHAT_API_KEY_SECRET]: "sk-build" },
    });
    expect(await provider.get(CHAT_API_KEY_SECRET)).toBe("sk-runtime");
  });

  it("falls back to the build-time key when the store is empty", async () => {
    const chatKey = createChatKeySettings();
    const provider = createSettingsSecretProvider({
      stores: { [CHAT_API_KEY_SECRET]: chatKey },
      fallback: { [CHAT_API_KEY_SECRET]: "sk-build" },
    });
    expect(await provider.get(CHAT_API_KEY_SECRET)).toBe("sk-build");
  });

  it("returns undefined when both store and fallback are empty", async () => {
    const chatKey = createChatKeySettings();
    const provider = createSettingsSecretProvider({ stores: { [CHAT_API_KEY_SECRET]: chatKey } });
    expect(await provider.get(CHAT_API_KEY_SECRET)).toBeUndefined();
  });

  it("coerces an empty or whitespace fallback to undefined (no 'Bearer ')", async () => {
    const chatKey = createChatKeySettings();
    for (const fb of ["", "   "]) {
      const provider = createSettingsSecretProvider({
        stores: { [CHAT_API_KEY_SECRET]: chatKey },
        fallback: { [CHAT_API_KEY_SECRET]: fb },
      });
      expect(await provider.get(CHAT_API_KEY_SECRET)).toBeUndefined();
    }
  });

  it("reflects a runtime change made after construction", async () => {
    const chatKey = createChatKeySettings();
    const provider = createSettingsSecretProvider({
      stores: { [CHAT_API_KEY_SECRET]: chatKey },
      fallback: { [CHAT_API_KEY_SECRET]: "sk-build" },
    });
    expect(await provider.get(CHAT_API_KEY_SECRET)).toBe("sk-build");
    chatKey.setApiKey("sk-runtime");
    expect(await provider.get(CHAT_API_KEY_SECRET)).toBe("sk-runtime");
    chatKey.clear();
    expect(await provider.get(CHAT_API_KEY_SECRET)).toBe("sk-build");
  });
});

describe("createSettingsSecretProvider — stt/tts keys resolve independently", () => {
  it("resolves each secret from its own store, then its own fallback", async () => {
    const stt = store();
    const tts = store();
    stt.setApiKey("sk-stt");
    const provider = createSettingsSecretProvider({
      stores: { [STT_API_KEY_SECRET]: stt, [TTS_API_KEY_SECRET]: tts },
      fallback: { [TTS_API_KEY_SECRET]: "sk-tts-build" },
    });
    expect(await provider.get(STT_API_KEY_SECRET)).toBe("sk-stt");
    expect(await provider.get(TTS_API_KEY_SECRET)).toBe("sk-tts-build");
  });
});

describe("createSettingsSecretProvider — names without a store", () => {
  it("returns the fallback value for an unrelated name", async () => {
    const provider = createSettingsSecretProvider({
      stores: {},
      fallback: { other_secret: "v" },
    });
    expect(await provider.get("other_secret")).toBe("v");
  });

  it("returns undefined for an unrelated name absent from fallback", async () => {
    const provider = createSettingsSecretProvider({ stores: {} });
    expect(await provider.get("other_secret")).toBeUndefined();
  });

  it("does not consult an unrelated store", async () => {
    const chatKey = createChatKeySettings();
    chatKey.setApiKey("sk-runtime");
    const getSpy = vi.spyOn(chatKey, "get");
    const provider = createSettingsSecretProvider({ stores: { [CHAT_API_KEY_SECRET]: chatKey } });
    await provider.get("other_secret");
    expect(getSpy).not.toHaveBeenCalled();
  });
});

describe("createSettingsSecretProvider — async SecretProvider shape", () => {
  it("get() returns a promise", () => {
    const provider = createSettingsSecretProvider({ stores: {} });
    expect(provider.get(CHAT_API_KEY_SECRET)).toBeInstanceOf(Promise);
  });

  it("never throws for any name", async () => {
    const provider = createSettingsSecretProvider({ stores: {} });
    await expect(provider.get(CHAT_API_KEY_SECRET)).resolves.toBeUndefined();
    await expect(provider.get("anything")).resolves.toBeUndefined();
  });
});
