// ─────────────────────────────────────────────────────────────────────────────
// API-key abstraction (migration layer toward the OS keychain at OSS entry)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Secret (e.g. chat api_key) lookup abstraction. Swap between plaintext (plainSecretProvider)
 * and a Tauri secure storage / OS keychain implementation **without changing call sites**.
 * The async signature is there to accommodate keychain access (IPC) up front.
 */
export interface SecretProvider {
  /** undefined when absent. Never throws (a missing key is normal — a local backend may be unauthenticated). */
  get(key: string): Promise<string | undefined>;
}

/**
 * Name used to look up the chat backend key in the SecretProvider (adapter specifics: `integrations/hermes/README.md`).
 * Call site (dispatcher): `streamChat(ep, req, { apiKey: await secrets.get(CHAT_API_KEY_SECRET) })`.
 * (Kept here rather than in chat-client — the secret name is config/SecretProvider's concern, unrelated to the openai SDK.)
 */
export const CHAT_API_KEY_SECRET = "chat_api_key";

/** SecretProvider name for the STT server key (OpenAI-compatible Bearer). */
export const STT_API_KEY_SECRET = "stt_api_key";

/** SecretProvider name for the TTS server key (Bearer). Only needed by servers that require one. */
export const TTS_API_KEY_SECRET = "tts_api_key";

/** Looks up from a plaintext record. Real values are best kept out of configs (env/keychain). */
export function plainSecretProvider(
  secrets: Record<string, string | undefined> = {},
): SecretProvider {
  return {
    async get(key) {
      return secrets[key];
    },
  };
}
