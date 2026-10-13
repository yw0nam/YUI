/** The wire shape of the frames the push socket carries and the checks that tell an unreadable one. */

import type { ExpressArgs, TurnEnded, Usage } from "../../../contract";

/** One ordered piece of a reply: its cues render, then its speech is spoken. */
export interface RenderSegment {
  cues?: ExpressArgs[];
  speech?: string;
}

/** A finished backend turn. Every frame the backend sends names the turn it belongs to. */
export interface RenderFrame {
  type: "render";
  turn_id: string;
  source: string;
  segments: RenderSegment[];
  /** The reasoning written so far for this turn when the reply was sent; absent when there was none. */
  reasoning?: string;
}

/** One finished sentence of a reply the backend is still writing; the turn's next render closes it. */
export interface SpeechFrame {
  type: "speech";
  turn_id: string;
  segments: RenderSegment[];
}

/** One piece of work the backend handed to a background worker. */
export interface DelegationItem {
  id: string;
  title: string;
  started_at: number;
  state: "running" | "done";
  ended_at?: number;
  status?: "ok" | "error" | "unknown";
  summary?: string;
}

/** The backend closed a turn: the running state the `turn` frame set is released. */
export interface TurnEndFrame {
  type: "turn_end";
  turn_id: string;
  /** The usage of the turn's last LLM call; absent when the backend has none. */
  usage?: Usage;
}

/** The turn failed; the backend's own failure text, sent before the turn's `turn_end`. */
export interface ErrorFrame {
  type: "error";
  turn_id: string;
  message: string;
}

/** The backend names the tool a turn is using; `running` when the call starts, `done` when it returns, `failed` when it failed. */
export interface ToolStatusFrame {
  type: "tool_status";
  turn_id: string;
  state: "running" | "done" | "failed";
  tool_id: string;
}

/** A call against a tool the client declared in `hello.tools`; the client answers with `tool_result`. */
export interface ToolCallFrame {
  type: "tool_call";
  id: string;
  turn_id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** The client's answer to one `tool_call`, carrying the same id and turn id. */
export interface ToolResultFrame {
  type: "tool_result";
  id: string;
  turn_id: string;
  result: string;
}

export interface PlaybackFrame {
  type: "playback";
  turn_id: string;
  ended: TurnEnded;
  spoken?: string;
  unspoken?: string;
}

/** The backend's reasoning as it is written, sent while the turn it names runs. */
export interface ReasoningFrame {
  type: "reasoning";
  turn_id: string;
  delta: string;
}

/** The backend accepted the handshake; the conversation runs under its chat id. */
export interface ReadyFrame {
  type: "ready";
  chat_id: string;
  /** Largest `turn` frame accepted, in UTF-8 bytes; its presence also says `turn` takes `images`. */
  max_turn_bytes?: number;
}

export interface PushTurnFrame {
  turn_id: string;
  /** The `<client_context>` block text, exactly as the other transports send it. */
  client_context: string;
  /** The user utterance; `""` on a turn no user typed or spoke. */
  text: string;
  /** `data:image/<subtype>;base64,<data>` strings: the screenshot first, then the attachments. */
  images?: string[];
}

/** An ordered list of objects whose speech is text and whose cues are objects. */
function segmentsReadable(segments: unknown): boolean {
  if (!Array.isArray(segments)) return false;
  for (const segment of segments) {
    if (segment === null || typeof segment !== "object" || Array.isArray(segment)) return false;
    const { speech, cues } = segment as { speech?: unknown; cues?: unknown };
    if (speech !== undefined && typeof speech !== "string") return false;
    if (
      cues !== undefined &&
      (!Array.isArray(cues) ||
        cues.some((cue) => cue === null || typeof cue !== "object" || Array.isArray(cue)))
    ) {
      return false;
    }
  }
  return true;
}

/**
 * The field that makes a render frame unreadable, or null when the client can act on it: readable
 * segments, a source to log, and the string turn id it answers. A turn_id of another type would
 * leave the turn that sent it waiting out its whole budget.
 */
export function renderFrameFault(v: Record<string, unknown>): string | null {
  if (!segmentsReadable(v.segments)) return "segments";
  if (typeof v.source !== "string") return "source";
  if (typeof v.turn_id !== "string") return "turn_id";
  return null;
}

/** A `usage` whose three token counts are all finite numbers. */
export function usageReadable(usage: unknown): usage is Usage {
  if (usage === null || typeof usage !== "object") return false;
  const { input_tokens, output_tokens, total_tokens } = usage as Record<string, unknown>;
  return [input_tokens, output_tokens, total_tokens].every(
    (count) => typeof count === "number" && Number.isFinite(count),
  );
}

/** The field that makes a speech frame unreadable, or null: readable segments and a string turn id. */
export function speechFrameFault(v: Record<string, unknown>): string | null {
  if (!segmentsReadable(v.segments)) return "segments";
  if (typeof v.turn_id !== "string") return "turn_id";
  return null;
}

/** The field that makes a tool_call frame unreadable, or null: string id, turn_id and name, and an arguments object. */
export function toolCallFrameFault(v: Record<string, unknown>): string | null {
  if (typeof v.id !== "string") return "id";
  if (typeof v.turn_id !== "string") return "turn_id";
  if (typeof v.name !== "string") return "name";
  if (v.arguments === null || typeof v.arguments !== "object" || Array.isArray(v.arguments)) {
    return "arguments";
  }
  return null;
}
