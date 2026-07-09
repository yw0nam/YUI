/**
 * signals-inbox — subscribes to the Rust `signals-inbox` Tauri event channel.
 *
 * Carries the opaque `signals` batch pushed by the n8n `/signals` ingress. Mirrors
 * `agent-inbox.ts` as a lightweight seam: degrades silently off-Tauri so the module
 * is safe in browser / test / dev environments without the runtime.
 */

import type { SignalItem } from "../contract";
import { createLogger } from "../logger";
import { type OsEventListen, resolveTauriListen } from "./tauri-listen";

const log = createLogger("signals-inbox");

/** Payload carried by the Rust `signals-inbox` event — mirrors src-tauri SignalsPayload. */
export type SignalsBatch = {
  signals: SignalItem[];
  ts: number;
};

const SIGNALS_INBOX_CHANNEL = "signals-inbox";

/**
 * Subscribe to the `signals-inbox` Tauri event. Returns a synchronous unsubscribe function.
 *
 * Off-Tauri (no `deps.listen` and not in Tauri), logs a debug message and returns a no-op.
 * Guards against callbacks firing after unsubscribe.
 */
export function onSignalsInbox(
  cb: (p: SignalsBatch) => void,
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
      unlistenFn = await listen(SIGNALS_INBOX_CHANNEL, ({ payload }) => {
        if (!cancelled) cb(payload as unknown as SignalsBatch);
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
