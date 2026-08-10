/**
 * agent-inbox — subscribes to the Rust `agent-inbox` Tauri event channel.
 *
 * Carries the "external agent lifecycle event" signal (task done, or the agent
 * needs the user's input). Mirrors `tauri-listen.ts` as a lightweight seam:
 * degrades silently off-Tauri so the module is safe in browser / test / dev
 * environments without the runtime.
 */

import { createInbox } from "./create-inbox";

/** Payload carried by the Rust `agent-inbox` event — mirrors src-tauri AgentEventPayload (snake_case over IPC). */
export type AgentEvent = {
  tool: string;
  project: string;
  cwd: string;
  status?: "success" | "error";
  phase: "done" | "needs_input";
  session_id?: string;
  detail?: string;
  summary: string;
  ts: number;
};

/** Subscribe to the `agent-inbox` Tauri event channel. */
export const onAgentInbox = createInbox<AgentEvent>("agent-inbox");
