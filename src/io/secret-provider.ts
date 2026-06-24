/**
 * 런타임 SecretProvider — 각 키를 매칭되는 런타임 스토어에서 해소하고, 없으면
 * build-time fallback으로 폴백한다. plainSecretProvider를 대체해 main.ts가 주입한다.
 *
 * 해소 규칙(이름별): 매칭 스토어(non-empty) → fallback(non-empty) → undefined.
 * 빈/공백 값은 undefined로 정규화한다(`Authorization: Bearer ` 전송 방지).
 * 값은 시크릿이다 — 절대 로깅하지 않는다.
 */

import type { SecretProvider } from "../config/load";
import type { ApiKeySettingsStore } from "./api-key-settings";

export interface SettingsSecretProviderOptions {
  /** secret 이름 → 런타임 오버라이드 스토어. apiKey가 비어 있으면 오버라이드 없음. */
  stores: Record<string, ApiKeySettingsStore>;
  /** build-time 값(예: VITE_YUI_*). 스토어가 비었을 때만 쓰인다. */
  fallback?: Record<string, string | undefined>;
}

export function createSettingsSecretProvider(opts: SettingsSecretProviderOptions): SecretProvider {
  const { stores, fallback } = opts;
  return {
    async get(name) {
      const override = stores[name]?.get().apiKey; // coerceApiKey로 이미 trim됨
      if (override) return override;
      const fb = fallback?.[name]?.trim();
      return fb ? fb : undefined;
    },
  };
}
