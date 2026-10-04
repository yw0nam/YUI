/** The wire shape of the frames the push socket carries and the checks that tell an unreadable one. */

import type { ExpressArgs } from "../../../contract";

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
}

/** The backend names the tool a turn is using; `running` when the call starts, `done` when it returns. */
export interface ToolStatusFrame {
  type: "tool_status";
  turn_id: string;
  state: "running" | "done";
  tool_id: string;
}

/** The backend's reasoning as it is written, sent while the turn it names runs. */
export interface ReasoningFrame {
  type: "reasoning";
  turn_id: string;
  delta: string;
}

export interface PushTurnFrame {
  turn_id: string;
  /** The `<client_context>` block text, exactly as the other transports send it. */
  client_context: string;
  /** The user utterance; `""` on a turn no user typed or spoke. */
  text: string;
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

/** The field that makes a speech frame unreadable, or null: readable segments and a string turn id. */
export function speechFrameFault(v: Record<string, unknown>): string | null {
  if (!segmentsReadable(v.segments)) return "segments";
  if (typeof v.turn_id !== "string") return "turn_id";
  return null;
}
