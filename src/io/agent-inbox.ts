/**
 * agent-inbox — subscribes to the Rust `agent-inbox` Tauri event channel.
 *
 * Carries the "external agent completed work" signal. Mirrors `tauri-listen.ts`
 * as a lightweight seam: degrades silently off-Tauri so the module is safe in
 * browser / test / dev environments without the runtime.
 */

import { createInbox } from "./create-inbox";

/** Payload carried by the Rust `agent-inbox` event — mirrors src-tauri AgentDonePayload (snake_case over IPC). */
export type AgentDone = {
  tool: string;
  project: string;
  cwd: string;
  status?: "success" | "error";
  summary: string;
  ts: number;
};

/** Subscribe to the `agent-inbox` Tauri event channel. */
export const onAgentInbox = createInbox<AgentDone>("agent-inbox");
