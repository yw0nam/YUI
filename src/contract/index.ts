/**
 * Contract barrel — wire contract 타입의 단일 진입점.
 * 다른 모듈은 `import { ... } from "../contract"` 로 접근한다.
 */
export type {
  // Emotion
  EmotionId,
  EmotionSignal,
  EmotionRegistryEntry,
  EmotionRegistry,
  // Motion
  MotionKind,
  InterruptPolicy,
  MotionSignal,
  MotionRegistryEntry,
  MotionRegistry,
  // Control envelope
  ExpressArgs,
  RichItem,
  ToolStatus,
  ControlEnvelope,
  Usage,
  SessionCompressionResponse,
  // Input context
  ScreenSource,
  InputContext,
  // Dispatcher-layer metadata
  TriggerMeta,
  DispatcherStateMeta,
  // Endpoint config
  EndpointsConfig,
  // Client-only geometry (window-sit perch)
  ScreenRect,
  WindowRect,
  PerchTarget,
} from "./types";
