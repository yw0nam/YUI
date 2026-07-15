/**
 * Contract barrel — single entry point for the wire contract types.
 * Other modules access them via `import { ... } from "../contract"`.
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
  // Client-only geometry (window-sit perch)
  ScreenRect,
  // Input context
  ScreenSource,
  SignalItem,
  ToolStatus,
  // Dispatcher-layer metadata
  TriggerMeta,
  Usage,
  WindowRect,
} from "./types";
