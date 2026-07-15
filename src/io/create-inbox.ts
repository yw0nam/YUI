import { createLogger } from "../logger";
import { type OsEventListen, resolveTauriListen } from "./tauri-listen";

/**
 * Generic Tauri inbox seam. Subscribes to `channel`, returns a synchronous
 * unsubscribe function. Off-Tauri (no `deps.listen` and not in Tauri) it logs a
 * debug message and returns a no-op. Guards against callbacks after unsubscribe.
 * The logger is named after the channel to preserve per-inbox log namespaces.
 */
export function createInbox<T>(
  channel: string,
): (cb: (p: T) => void, deps?: { listen?: OsEventListen }) => () => void {
  const log = createLogger(channel);
  return (cb, deps) => {
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
        unlistenFn = await listen(channel, ({ payload }) => {
          if (!cancelled) cb(payload as unknown as T);
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
  };
}
