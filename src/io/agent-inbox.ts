/**
 * agent-inbox — subscribes to the Rust `agent-inbox` Tauri event channel.
 *
 * Carries the "external agent completed work" signal. Mirrors `tauri-listen.ts`
 * as a lightweight seam: degrades silently off-Tauri so the module is safe in
 * browser / test / dev environments without the runtime.
 */

import { createLogger } from "../logger";
import { type OsEventListen, resolveTauriListen } from "./tauri-listen";

const log = createLogger("agent-inbox");

/** Payload carried by the Rust `agent-inbox` event — mirrors src-tauri AgentDonePayload (snake_case over IPC). */
export type AgentDone = {
  tool: string;
  project: string;
  cwd: string;
  status?: "success" | "error";
  summary: string;
  ts: number;
};

const AGENT_INBOX_CHANNEL = "agent-inbox";

/**
 * Subscribe to the `agent-inbox` Tauri event. Returns a synchronous unsubscribe function.
 *
 * Off-Tauri (no `deps.listen` and not in Tauri), logs a debug message and returns a no-op.
 * Guards against callbacks firing after unsubscribe.
 */
export function onAgentInbox(
  cb: (p: AgentDone) => void,
  deps?: { listen?: OsEventListen },
): () => void {
  let unlistenFn: (() => void) | undefined;
  let cancelled = false;

  void (async () => {
    let listen: OsEventListen | undefined;
    try {
      listen = deps?.listen ?? (await resolveTauriListen());
    } catch (err) {
      log.debug("listen_resolve_failed", { degrade: true, error: String(err) });
      return;
    }
    if (!listen) {
      log.debug("listen_unavailable", { degrade: true });
      return;
    }
    if (cancelled) return;
    try {
      unlistenFn = await listen(AGENT_INBOX_CHANNEL, ({ payload }) => {
        if (!cancelled) cb(payload as unknown as AgentDone);
      });
    } catch (err) {
      log.debug("subscribe_failed", { degrade: true, error: String(err) });
    }
    if (cancelled) {
      unlistenFn?.();
      unlistenFn = undefined;
    }
  })();

  return () => {
    cancelled = true;
    unlistenFn?.();
    unlistenFn = undefined;
  };
}
