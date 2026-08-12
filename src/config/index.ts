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
  ATTACHMENT_LIMITS_DEFAULTS,
  type AttachmentLimits,
  type AvatarConfig,
  CHAT_API_KEY_SECRET,
  CONFIG_FILES,
  ConfigError,
  type ConfigReader,
  type ConfigSection,
  DRAG_HOLD_MS_DEFAULT,
  GESTURE_CUES_DEFAULTS,
  type GestureCueConfig,
  type GestureCuesConfig,
  type GuardrailsConfig,
  type LoadConfigOptions,
  loadConfig,
  PEEK_DEFAULTS,
  type PeekConfig,
  plainSecretProvider,
  type SecretProvider,
  STT_API_KEY_SECRET,
  TAP_DEFAULTS,
  type TapConfig,
  TTS_API_KEY_SECRET,
} from "./load";

export {
  type ConfigErrorListener,
  type ConfigListener,
  type ConfigStore,
  type ConfigStoreOptions,
  createConfigStore,
} from "./store";
