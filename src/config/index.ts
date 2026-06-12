/**
 * Config barrel — config 로더/스토어의 단일 진입점.
 * 다른 모듈은 `import { ... } from "../config"` 로 접근한다.
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
} from "./load";

export {
  type ConfigErrorListener,
  type ConfigListener,
  type ConfigStore,
  type ConfigStoreOptions,
  createConfigStore,
} from "./store";
