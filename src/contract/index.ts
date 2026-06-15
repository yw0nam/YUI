/**
 * Contract barrel — wire contract 타입의 단일 진입점.
 * 다른 모듈은 `import { ... } from "../contract"` 로 접근한다.
 */
export type {
  // Flat system-message context (client → backend each turn)
  ClientContext,
  ControlEnvelope,
  CueMeta,
  // Emotion
  EmotionId,
  EmotionRegistry,
  EmotionRegistryEntry,
  EmotionSignal,
  // Endpoint config
  EndpointsConfig,
  // Control envelope
  ExpressArgs,
  InputContext,
  InterruptPolicy,
  // Motion
  MotionKind,
  MotionRegistry,
  MotionRegistryEntry,
  MotionSignal,
  PerchTarget,
  RichItem,
  // Client-only geometry (window-sit perch)
  ScreenRect,
  // Input context
  ScreenSource,
  SessionCompressionResponse,
  ToolStatus,
  // Dispatcher-layer metadata
  TriggerMeta,
  Usage,
  WindowRect,
} from "./types";
