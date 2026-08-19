/**
 * YUI ↔ Hermes contract — TypeScript types. These types are the wire schema source of truth.
 *
 * Transmission protocol summary:
 *  - Control signals (emotion_id/motion_id/emotion_text) arrive as arguments to the server-side
 *    `generate_express` tool-call (flat string arguments).
 *  - Speech text is not a tool-call but a separate assistant text stream (response.output_text.delta).
 *  - Both generate_express and emotion are optional — turns without them remain idle and retain the prior expression.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Emotion Vocabulary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Emotion enum that the backend can send each turn.
 * The standard 6 emotions match the VRM 1.0 preset as-is; the 4 extended emotions map via fallback chain.
 */
export type EmotionId =
  | "neutral"
  | "happy"
  | "angry"
  | "sad"
  | "relaxed"
  | "surprised"
  | "thinking"
  | "curious"
  | "sleepy"
  | "embarrassed";

/** Normalized form of `ExpressArgs.emotion_id` — the id is all the wire carries. */
export interface EmotionSignal {
  id: EmotionId;
}

/**
 * A single entry from configs/emotion_registry.json.
 * emotion enum → VRM expression key + fallback chain. Final fallback is always "neutral".
 */
export interface EmotionRegistryEntry {
  /** VRM expression key (standard preset key or model-custom key). */
  vrm_expression: string;
  /** Emotion id or expression key to fall back to when the expression is unavailable. */
  fallback: string;
}

export type EmotionRegistry = Partial<Record<EmotionId, EmotionRegistryEntry>>;

// ─────────────────────────────────────────────────────────────────────────────
// Motion Registry
// ─────────────────────────────────────────────────────────────────────────────

export type MotionKind = "ambient" | "reactive" | "state" | "oneshot";
export type InterruptPolicy = "replace" | "queue" | "ignore";

/** Normalized form of `ExpressArgs.motion_id` — the registry key is all the wire carries. */
export interface MotionSignal {
  /** registry key. */
  id: string;
}

/**
 * A single entry from configs/motions.json. The registry is the source of truth for priority/interrupt —
 * the backend only needs to know the ID string.
 */
export interface MotionRegistryEntry {
  /** VRMA file path (Vite public → "/motions/<id>.vrma"). When variants are used, this is the default/representative path (=variants[0]). */
  vrma_path: string;
  /** Pool of 2+ VRMAs. If present, the client selects one per entry for playback (variant_policy); otherwise uses vrma_path alone. */
  variants?: string[];
  /** Selection policy when variants exist. Default "random". */
  variant_policy?: "random" | "sequential";
  /** Milliseconds to hold the final (settling) frame before swapping to the next variant in a cycle motion. If absent/0, swap immediately. Requires variants>1 + loop. */
  cycle_dwell_ms?: number;
  /** Entry-level default crossfade in milliseconds — used when signal omits fade_ms. Falls back to 200 if absent. */
  fade_ms?: number;
  /** If true, single-variant loop motions self-crossfade loop seams instead of using hard LoopRepeat. */
  crossfade_loop?: boolean;
  /** ping-pong (forward↔reverse) loop. requires loop=true. mutually exclusive with crossfade_loop. */
  pingpong?: boolean;
  /** [min,max] ping-pong round trips before a multi-variant motion swaps variant. default [1,1]. ignored for single-variant (continuous). */
  loop_cycles?: [number, number];
  /** If false, excluded from broker (agent) vocabulary — local render only. Default true. */
  broker_publish?: boolean;
  kind: MotionKind;
  loop: boolean;
  /** 0~100, higher is higher priority. */
  priority: number;
  interrupt_policy: InterruptPolicy;
}

export type MotionRegistry = Record<string, MotionRegistryEntry>;

// ─────────────────────────────────────────────────────────────────────────────
// Control Signal Envelope
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Arguments of the `generate_express` tool-call = transport payload.
 * FLAT string arguments — these are the only control fields that actually traverse the wire. All are optional;
 * turns without generate_express are empty.
 * Silence is represented by speech_text being an empty string.
 */
export interface ExpressArgs {
  /** Emotion enum id. If absent, retain prior expression. Client normalizes to EmotionSignal{id}. */
  emotion_id?: string;
  /** Motion registry key. If absent, client derives from emotion. Normalized to MotionSignal{id}. */
  motion_id?: string;
  /** TTS voice tag (example: "[whisper in small voice]") — free text. Normalized via emotion_text channel. */
  emotion_text?: string;
}

/** Usage from Responses `response.completed` event — input for tracking current session token consumption. */
export interface Usage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

/** Derived from client observation of function_call items from native Hermes tools (not express). */
export interface ToolStatus {
  state: "idle" | "running" | "done" | "error";
  /** function_call name. */
  tool_id?: string;
}

/**
 * Client-internal normalized form. Combines express arguments + text stream + native
 * function_call observation into render directive input. Not a wire schema but a form reconstructed by the client.
 */
export interface ControlEnvelope {
  // --- generate_express tool-call arguments (only when present) ---
  // Silence is represented by speech_text being an empty string.
  emotion?: EmotionSignal | null;
  motion?: MotionSignal | null;
  /** generate_express.emotion_text — free text for TTS voice tag. Backend-caller routes via onCue; tts-pipeline prefixes to sentence synthesis. */
  emotion_text?: string | null;

  // --- Assembled from text stream (not a tool field) ---
  /** Accumulated response.output_text.delta. Empty string if no utterance. */
  speech_text: string;

  // --- Derived from observation of native Hermes tool function_call items ---
  tool_status?: ToolStatus | null;

  /** All ignored in v0. */
  _reserved?: {
    expression_frames?: unknown[];
    visemes?: unknown[];
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Input Context Schema (client → backend)
// ─────────────────────────────────────────────────────────────────────────────

/** Capture source. User selects from monitor / browser tab / window. */
export type ScreenSource =
  | { kind: "monitor"; index: number; label?: string }
  | { kind: "browser_tab"; browser: string; tab_title: string; url?: string }
  | { kind: "window"; app: string; window_title: string };

export interface Posture {
  state: "sitting" | "peeking" | "dragging";
  perched_on?: {
    /** Stable app-owner name. */
    app?: string;
    window_title?: string;
  };
}

/** Held posture plus when it started. Only exists while a posture is held. */
export interface BodyState {
  posture: Posture;
  /** Epoch ms (wall clock) of the posture change — survives the window being hidden. */
  since: number;
}

/** Latest frontmost-window sample. Fields absent when the platform did not resolve them. */
export interface FrontmostState {
  app?: string;
  window_title?: string;
  /** Epoch ms (wall clock) of the last frontmost transition — stable across unchanged polls. */
  since: number;
}

/**
 * Internal shape returned by packageContext. Carries user utterance and screenshot data_url
 * for assembly into the Responses API request — NOT serialized to the system message.
 */
export interface InputContext {
  /** Keyboard input or STT result (internal use only; not included in system context). */
  user_text?: string;

  env: {
    /** ISO 8601. */
    timestamp: string;
    /** Example: "Asia/Seoul". Always filled by client. */
    timezone: string;
  };

  screenshot?: {
    /** Explicitly specifies the toggle state itself. */
    enabled: boolean;
    source: ScreenSource;
    /** "data:image/png;base64,..." or "https://...". Internal use only; removed from system context. */
    data_url?: string;
  };

  /** User-attached images (data URLs). Internal use only; not included in system context. */
  user_images?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Flat client_context — the system message object sent to the backend each turn.
// Contains only context (env, screenshot meta, trigger) — NO user utterance text.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * cue forwarded from schedule/proactive firing sources. id is omitted from the wire shape.
 * context is user-authored intent — built-in touch/gesture cues send a label only.
 */
export interface CueMeta {
  label: string;
  context?: string;
  local_time?: string;
  idle_min?: number;
}

/** one item in a signals.kind burst. heterogeneous by design — taxonomy owned by n8n + Hermes, client forwards verbatim. */
export type SignalItem = Record<string, unknown>;

/** trigger envelope describing what fired this backend turn. */
export interface TriggerMeta {
  kind: "user" | "schedule" | "proactive" | "agent" | "signals";
  cue?: CueMeta;
  /** proactive only: Math.round(gap_ms / 60000). */
  idle_elapsed_min?: number;
  /** agent.done / agent.needs_input — single coding-agent lifecycle event. */
  agent?: {
    tool: string; // "claude-code" | "opencode" | <string>
    project: string;
    cwd: string;
    status?: "success" | "error"; // meaningful for phase:"done" only
    phase: "done" | "needs_input";
    session_id?: string; // opaque pass-through, no client interpretation
    detail?: string; // judgment material for the backend, e.g. transcript excerpt or pending tool call
    summary: string; // speech material from the external hook (already summarized or raw)
    ts: number; // client epoch ms
  };
  /** agent.catchup — burst of buffered lifecycle events on return. */
  agent_catchup?: {
    count: number;
    items: Array<{
      tool: string;
      project: string;
      status?: "success" | "error";
      phase: "done" | "needs_input";
      session_id?: string;
      detail?: string;
      summary: string;
      ts: number;
    }>;
  };
  /** signals.ingress — opaque burst forwarded verbatim from the n8n /signals ingress. no per-item shape assumed. */
  signals?: SignalItem[];
  /** proactive.screen_* — a frontmost-app transition fired this turn. */
  screen?: {
    transition: "app_switched" | "long_session";
    from_app?: string; // app left behind; app_switched only
    from_dwell_min?: number; // minutes it held the foreground
    dwell_min: number; // current app's foreground minutes at fire time
    /** app_switched transitions held back by the global pacer, oldest first. Present only when non-empty. */
    recent?: Array<{ from_app: string; to_app: string; dwell_min: number }>;
  };
}

/**
 * Flat system-message context object. Carries environment, screenshot meta (no data_url),
 * body state and trigger — never carries user utterance text.
 */
export interface ClientContext {
  env: {
    timestamp: string;
    timezone: string;
    /** Present once an OS frontmost sample exists; absent on unsupported platforms. */
    frontmost?: FrontmostState;
  };
  screenshot?: {
    enabled: boolean;
    source: ScreenSource;
  };
  /** Present only while a posture is held; absent while the avatar stands free. */
  body_state?: BodyState;
  trigger: TriggerMeta;
}

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint config
// ─────────────────────────────────────────────────────────────────────────────

/**
 * configs/endpoints.json. The three base URLs (chat/stt/tts) are separate processes.
 * Every service address is optional: `""` means "not configured" — STT/TTS/broker stay off and a
 * chat turn fails with `not_configured` instead of reaching the network.
 */
export interface EndpointsConfig {
  /**
   * Backend agent API root (example: `http://localhost:8643/v1`). The OpenAI SDK appends `/responses` after this,
   * so this is the root including `/v1` (streamChat uses only this value as baseURL). `""` = not configured.
   */
  chat_base_url: string;
  /**
   * Informational / non-SDK fallback path. Default "/v1/responses", fallback "/v1/chat/completions".
   * `""` = not configured.
   * ⚠ SDK path (streamChat) does not use this field — determined by chat_base_url + SDK append.
   *   Do not combine as `chat_base_url + chat_endpoint` (already has `/v1` duplication).
   */
  chat_endpoint: string;
  /**
   * System nudge to send in the Responses API `instructions` field (config-driven, not hard-coded).
   * Encourages use of the generate_express tool (emotion_id/motion_id/emotion_text). Omitted if not set.
   */
  chat_instructions?: string;
  /**
   * Chat model ID (OpenAI Responses `model` parameter), as served by the backend's `/v1/models`.
   * Model ID is under config ownership (not hard-coded). If not set, streamChat omits model —
   * backends that require model may return 4xx.
   */
  chat_model?: string;
  /**
   * Chat protocol for YUI to use. "responses" (default, legacy) | "chat_completions" (new).
   * If not set, streamChat operates as "responses" (backward compatible).
   */
  chat_api?: "responses" | "chat_completions";
  /** Separate ASR service (OpenAI-compatible) → /audio/transcriptions. `""` = STT off. */
  stt_base_url: string;
  /** Separate TTS service (OpenAI-compatible) → /audio/speech. `""` = TTS off. */
  tts_base_url: string;
  /** /v1/audio/speech `model`. Must match the name the TTS server is configured under. */
  tts_model?: string;
  /** Default speaker id, used until the user picks another in the panel. */
  tts_speaker?: string;
  /** Synthesis concurrency limit. Default 1 (serial) — applied by consumer (tts-pipeline), not loader. */
  tts_max_inflight?: number;
  /** Expression Broker MCP endpoint (streamable-http, example: `http://localhost:3201/mcp`). Skips vocab publish if not set. */
  broker_base_url?: string;
  /** Maximum context token count for the active chat model. */
  chat_model_context_window?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Client-only geometry (window-sit perch) ──
// Outside backend contract — pure render input not carried in generate_express / ControlEnvelope.
// ─────────────────────────────────────────────────────────────────────────────

/** A rectangle in global screen coordinates (points, top-left origin). */
export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** An on-screen foreign window (matches the Rust `list_windows()` / `WindowAtPoint` payload, points). */
export interface WindowRect extends ScreenRect {
  name: string | null;
  ownerName: string | null;
  pid: number;
  /** kCGWindowNumber — stable window identity used to track the perched window across the stack. */
  windowNumber: number;
}

/** Client-only perch target handed to the renderer: which window edge the character sits on. */
export interface PerchTarget {
  rect: ScreenRect;
  edge: "top";
}
