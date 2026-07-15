/**
 * chat API key override store — a thin wrapper over the generic api-key-settings factory.
 * The storage key ("yui.chat-key") and behavior are unchanged. The value is a secret — never logged.
 */

import {
  API_KEY_MAX_LEN,
  type ApiKeySettings,
  type ApiKeyStorage,
  createApiKeySettings,
  localStorageApiKeyStorage,
} from "./api-key-settings";

/** Upper bound guarding against abnormally long input. */
export const CHAT_KEY_MAX_LEN = API_KEY_MAX_LEN;

export type ChatKeySettings = ApiKeySettings;
export type ChatKeyStorage = ApiKeyStorage;

export function createChatKeySettings(opts?: {
  storage?: ChatKeyStorage;
  initial?: ChatKeySettings;
}) {
  return createApiKeySettings({ ...opts, maxLen: CHAT_KEY_MAX_LEN });
}

/** chat-key store instance type (for SecretProvider injection). */
export type ChatKeySettingsStore = ReturnType<typeof createChatKeySettings>;

/** localStorage-based ChatKeyStorage adapter. */
export function localStorageChatKeyStorage(key = "yui.chat-key"): ChatKeyStorage {
  return localStorageApiKeyStorage(key);
}
