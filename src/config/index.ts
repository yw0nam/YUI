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
  type AttachmentLimits,
  type AvatarConfig,
  CHAT_API_KEY_SECRET,
  type ClimbConfig,
  CONFIG_FILES,
  ConfigError,
  type ConfigReader,
  type ConfigSection,
  type DescendConfig,
  type FallConfig,
  type FramingConfig,
  type GazeKnobs,
  type GestureCueConfig,
  type GestureCuesConfig,
  type GuardrailsConfig,
  type HitTestKnobs,
  type JumpConfig,
  type LoadConfigOptions,
  loadConfig,
  type PeekConfig,
  type PerchWalkConfig,
  plainSecretProvider,
  type ScreenConfig,
  type SecretProvider,
  STT_API_KEY_SECRET,
  type TapConfig,
  TTS_API_KEY_SECRET,
  type WalkConfig,
} from "./load";

export {
  type ConfigErrorListener,
  type ConfigListener,
  type ConfigStore,
  type ConfigStoreOptions,
  createConfigStore,
} from "./store";
