/**
 * 런타임 SecretProvider — chat 키를 런타임 스토어에서 해소하고, 없으면 build-time
 * fallback으로 폴백한다. plainSecretProvider를 대체해 main.ts가 주입한다.
 *
 * 해소 규칙(CHAT_API_KEY_SECRET): 런타임 스토어(non-empty) → fallback → undefined.
 * 그 외 이름: fallback 조회만. 값은 시크릿이다 — 절대 로깅하지 않는다.
 */

import { CHAT_API_KEY_SECRET, type SecretProvider } from "../config/load";
import type { ChatKeySettingsStore } from "./chat-key-settings";

export interface SettingsSecretProviderOptions {
  /** chat 키 오버라이드 스토어. apiKey가 비어 있으면 오버라이드 없음으로 본다. */
  chatKey: ChatKeySettingsStore;
  /** build-time 값(예: VITE_YUI_CHAT_KEY). 스토어가 비었을 때만 쓰인다. */
  fallback?: Record<string, string | undefined>;
}

export function createSettingsSecretProvider(opts: SettingsSecretProviderOptions): SecretProvider {
  const { chatKey, fallback } = opts;
  return {
    async get(name) {
      if (name === CHAT_API_KEY_SECRET) {
        const override = chatKey.get().apiKey;
        if (override) return override;
      }
      return fallback?.[name];
    },
  };
}
