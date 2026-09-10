/**
 * chat API key override store — a thin wrapper over the generic api-key-settings factory.
 * The storage key ("yui.chat-key") and behavior are unchanged. The value is a secret — never logged.
 */

import {
  type ApiKeyStorage,
  createApiKeySettings,
  localStorageApiKeyStorage,
} from "./api-key-settings";

type ChatKeyStorage = ApiKeyStorage;

export function createChatKeySettings(opts?: { storage?: ChatKeyStorage }) {
  return createApiKeySettings(opts);
}

/** chat-key store instance type (for SecretProvider injection). */
export type ChatKeySettingsStore = ReturnType<typeof createChatKeySettings>;

/** localStorage-based ChatKeyStorage adapter. */
export function localStorageChatKeyStorage(key = "yui.chat-key"): ChatKeyStorage {
  return localStorageApiKeyStorage(key);
}
