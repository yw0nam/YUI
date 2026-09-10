/**
 * Generic reactive API-key override store — backs the chat/stt/tts key settings.
 * "" = no override (the SecretProvider then falls back to the build-time key).
 * Values are trimmed and length-capped. The key is a secret — never logged.
 */

import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

/** Generous upper bound on key length — well above any real key. */
export const API_KEY_MAX_LEN = 4096;

interface ApiKeySettings {
  apiKey: string;
}

export type ApiKeyStorage = PersistedStorage<ApiKeySettings>;

function coerceApiKey(v: unknown): string {
  if (typeof v !== "string") return "";
  const trimmed = v.trim();
  return trimmed.length > API_KEY_MAX_LEN ? trimmed.slice(0, API_KEY_MAX_LEN) : trimmed;
}

function isValidSettings(v: unknown): v is ApiKeySettings {
  if (v === null || typeof v !== "object") return false;
  return typeof (v as Record<string, unknown>).apiKey === "string";
}

interface CreateApiKeySettingsOptions {
  /** Explicit storage adapter (takes precedence over storageKey). */
  storage?: ApiKeyStorage;
  /** Convenience: build a localStorage adapter from this key. */
  storageKey?: string;
}

export function createApiKeySettings(opts: CreateApiKeySettingsOptions = {}) {
  const storage =
    opts.storage ??
    (opts.storageKey ? localStorageStore<ApiKeySettings>(opts.storageKey) : undefined);

  const core = createPersistedStore<ApiKeySettings>({
    storage,
    defaults: { apiKey: "" },
    parse: (v) => (isValidSettings(v) ? { apiKey: coerceApiKey(v.apiKey) } : null),
    equals: (a, b) => a.apiKey === b.apiKey,
  });

  return {
    get: core.get,

    setApiKey(v: string): void {
      if (typeof v !== "string") return;
      core.commit({ apiKey: coerceApiKey(v) });
    },

    clear(): void {
      core.commit({ apiKey: "" });
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

/** Key-store instance type (SecretProvider injection). */
export type ApiKeySettingsStore = ReturnType<typeof createApiKeySettings>;

/** localStorage adapter for any api-key store. */
export function localStorageApiKeyStorage(key: string): ApiKeyStorage {
  return localStorageStore<ApiKeySettings>(key);
}

/** STT server key store (OpenAI-compatible Bearer). */
export function createSttKeySettings(opts?: { storage?: ApiKeyStorage }) {
  return createApiKeySettings({ storageKey: "yui.stt-key", ...opts });
}

/** TTS server key store (OpenAI-compatible Bearer). */
export function createTtsKeySettings(opts?: { storage?: ApiKeyStorage }) {
  return createApiKeySettings({ storageKey: "yui.tts-key", ...opts });
}
