/**
 * Config barrel — config 로더/스토어의 단일 진입점.
 * 다른 모듈은 `import { ... } from "../config"` 로 접근한다.
 */
export {
  loadConfig,
  ConfigError,
  plainSecretProvider,
  CHAT_API_KEY_SECRET,
  CONFIG_FILES,
  type AppConfig,
  type AvatarConfig,
  type ConfigSection,
  type ConfigReader,
  type LoadConfigOptions,
  type SecretProvider,
} from "./load";

export {
  createConfigStore,
  type ConfigStore,
  type ConfigStoreOptions,
  type ConfigListener,
  type ConfigErrorListener,
} from "./store";
