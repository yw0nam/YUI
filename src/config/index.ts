/**
 * Config barrel — single entry point for the config loader/store.
 * Other modules access it via `import { ... } from "../config"`.
 */

export {
  type LoadEmotionTextOptions,
  loadEmotionTextTable,
} from "./emotion-text";
export {
  type AppConfig,
  type AvatarConfig,
  CHAT_API_KEY_SECRET,
  CONFIG_FILES,
  ConfigError,
  type ConfigReader,
  type ConfigSection,
  type GuardrailsConfig,
  type LoadConfigOptions,
  loadConfig,
  plainSecretProvider,
  type SecretProvider,
  STT_API_KEY_SECRET,
  TTS_API_KEY_SECRET,
} from "./load";

export {
  type ConfigErrorListener,
  type ConfigListener,
  type ConfigStore,
  type ConfigStoreOptions,
  createConfigStore,
} from "./store";
