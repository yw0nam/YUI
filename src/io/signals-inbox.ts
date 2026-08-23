/**
 * signals-inbox — subscribes to the Rust `signals-inbox` Tauri event channel.
 *
 * Carries the opaque `signals` batch pushed by the n8n `/signals` ingress. Mirrors
 * `agent-inbox.ts` as a lightweight seam: degrades silently off-Tauri so the module
 * is safe in browser / test / dev environments without the runtime.
 */

import type { SignalItem } from "../contract";
import { createInbox } from "./create-inbox";

/** Payload carried by the Rust `signals-inbox` event — mirrors src-tauri SignalsPayload. */
export type SignalsBatch = {
  signals: SignalItem[];
  envelope?: unknown;
  ts: number;
};

/** Subscribe to the `signals-inbox` Tauri event channel. */
export const onSignalsInbox = createInbox<SignalsBatch>("signals-inbox");
