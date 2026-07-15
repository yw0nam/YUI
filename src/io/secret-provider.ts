/**
 * Runtime SecretProvider — resolves each key from the matching runtime store, or
 * falls back to build-time fallback. Injected by main.ts to replace plainSecretProvider.
 *
 * Resolution rule (by name): matching store (non-empty) → fallback (non-empty) → undefined.
 * Empty/whitespace values normalize to undefined (prevents sending `Authorization: Bearer `).
 * Values are secrets — never log them.
 */

import type { SecretProvider } from "../config/load";
import type { ApiKeySettingsStore } from "./api-key-settings";

export interface SettingsSecretProviderOptions {
  /** secret name → runtime override store. No override if apiKey is empty. */
  stores: Record<string, ApiKeySettingsStore>;
  /** build-time value (e.g., VITE_YUI_*). Used only when store is empty. */
  fallback?: Record<string, string | undefined>;
}

export function createSettingsSecretProvider(opts: SettingsSecretProviderOptions): SecretProvider {
  const { stores, fallback } = opts;
  return {
    async get(name) {
      const override = stores[name]?.get().apiKey; // already trimmed by coerceApiKey
      if (override) return override;
      const fb = fallback?.[name]?.trim();
      return fb ? fb : undefined;
    },
  };
}
