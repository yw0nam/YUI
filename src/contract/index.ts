/**
 * Contract barrel — single entry point for the wire contract types.
 * Other modules access them via `import { ... } from "../contract"`.
 */
export type {
  // Current posture reported each turn
  BodyState,
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
  // Latest frontmost-window sample reported each turn
  FrontmostState,
  InputContext,
  InterruptPolicy,
  // Motion
  MotionKind,
  MotionRegistry,
  MotionRegistryEntry,
  MotionSignal,
  Posture,
  // Last turn with backend speech, as the client remembers it
  PreviousTurn,
  // Client-only geometry (window-sit perch)
  ScreenRect,
  // Input context
  ScreenSource,
  SignalEnvelope,
  SignalGroup,
  SignalItem,
  ToolStatus,
  // Dispatcher-layer metadata
  TriggerMeta,
  TurnEnded,
  Usage,
  WindowRect,
} from "./types";
