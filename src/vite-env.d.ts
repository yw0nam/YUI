/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * dev 전용 Hermes chat API 키. `.env.local`의 `VITE_YUI_CHAT_KEY`로 주입.
   * prod/OSS는 평문 env 대신 OS keychain SecretProvider 구현으로 교체(concept §2.F).
   */
  readonly VITE_YUI_CHAT_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
