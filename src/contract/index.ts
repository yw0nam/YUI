/**
 * Contract barrel — docs/contract.md §1~§4 타입의 단일 진입점.
 * 다른 모듈은 `import { ... } from "../contract"` 로 접근한다.
 */
export type {
  // §1 Emotion
  EmotionId,
  EmotionSignal,
  EmotionRegistryEntry,
  EmotionRegistry,
  // §2 Motion
  MotionKind,
  InterruptPolicy,
  MotionSignal,
  MotionRegistryEntry,
  MotionRegistry,
  // §3 Control envelope
  ExpressArgs,
  RichItem,
  ToolStatus,
  ControlEnvelope,
  Usage,
  SessionCompressionResponse,
  // §4 Input context
  ScreenSource,
  InputContext,
  // Endpoint config
  EndpointsConfig,
} from "./types";
