/**
 * chat API 키 오버라이드 스토어 — 제네릭 api-key-settings 팩토리의 얇은 래퍼.
 * storage 키("yui.chat-key")와 동작은 종전과 동일하다. 값은 시크릿 — 절대 로깅하지 않는다.
 */

import {
  API_KEY_MAX_LEN,
  type ApiKeySettings,
  type ApiKeyStorage,
  createApiKeySettings,
  localStorageApiKeyStorage,
} from "./api-key-settings";

/** 비정상적으로 긴 입력 방어용 상한. */
export const CHAT_KEY_MAX_LEN = API_KEY_MAX_LEN;

export type ChatKeySettings = ApiKeySettings;
export type ChatKeyStorage = ApiKeyStorage;

export function createChatKeySettings(opts?: {
  storage?: ChatKeyStorage;
  initial?: ChatKeySettings;
}) {
  return createApiKeySettings({ ...opts, maxLen: CHAT_KEY_MAX_LEN });
}

/** chat-key 스토어 인스턴스 타입 (SecretProvider 주입용). */
export type ChatKeySettingsStore = ReturnType<typeof createChatKeySettings>;

/** localStorage 기반 ChatKeyStorage 어댑터. */
export function localStorageChatKeyStorage(key = "yui.chat-key"): ChatKeyStorage {
  return localStorageApiKeyStorage(key);
}
