/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Dev-only Hermes chat API key. Injected via `VITE_YUI_CHAT_KEY` in `.env.local`.
   * prod/OSS replaces the plaintext env with an OS keychain SecretProvider implementation.
   */
  readonly VITE_YUI_CHAT_KEY?: string;
  /** dev STT server key (Bearer). `VITE_YUI_STT_KEY` in `.env.local`. Only needed for STT servers that require a key. */
  readonly VITE_YUI_STT_KEY?: string;
  /** dev openai-compatible TTS server key (Bearer). `VITE_YUI_TTS_KEY` in `.env.local`. Not needed for irodori. */
  readonly VITE_YUI_TTS_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
