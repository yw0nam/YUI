/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * dev 전용 Hermes chat API 키. `.env.local`의 `VITE_YUI_CHAT_KEY`로 주입.
   * prod/OSS는 평문 env 대신 OS keychain SecretProvider 구현으로 교체.
   */
  readonly VITE_YUI_CHAT_KEY?: string;
  /** dev STT server key (Bearer). `.env.local`의 `VITE_YUI_STT_KEY`. 키 요구 STT 서버에만 필요. */
  readonly VITE_YUI_STT_KEY?: string;
  /** dev openai-compatible TTS server key (Bearer). `.env.local`의 `VITE_YUI_TTS_KEY`. irodori는 불필요. */
  readonly VITE_YUI_TTS_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
