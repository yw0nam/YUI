/**
 * Contract barrel — single entry point for the wire contract types.
 * Other modules access them via `import { ... } from "../contract"`.
 */
export type {
  // Pending read or write on a terminal — the Allow / Deny card
  AccessRequest,
  // Ask answers shared by Threads and push
  AskAnswer,
  // Current posture reported each turn
  BodyState,
  // Flat system-message context (client → backend each turn)
  ClientContext,
  ControlEnvelope,
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
  GuideKey,
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
  // PTY terminal shared by the user and a preset
  Terminal,
  TerminalOwner,
  TerminalSnapshot,
  // Threads store snapshot
  Thread,
  ThreadAsk,
  ThreadChoice,
  ThreadEntry,
  ThreadsSnapshot,
  ToolStatus,
  // Dispatcher-layer metadata
  TriggerMeta,
  TtsProviderName,
  TurnEnded,
  Usage,
  UtteranceIdentity,
  WindowRect,
} from "./types";

export { BACKEND_EVENT_NAME } from "./types";
