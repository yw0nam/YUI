import type { Options } from "@tauri-apps/api/event";
import { createLogger } from "../../../logger";
import { isTauri } from "../../../tauri-env";
import { type OsEventListen, resolveTauriListen } from "../../window/tauri-listen";

export type InboxListen = (
  event: string,
  handler: Parameters<OsEventListen>[1],
  options?: Options,
) => ReturnType<OsEventListen>;

/**
 * Generic Tauri inbox seam. Targets this webview on `channel`, returns a synchronous
 * unsubscribe function. Off-Tauri (no `deps.listen` and not in Tauri) it logs a
 * debug message and returns a no-op. Guards against callbacks after unsubscribe.
 * The logger is named after the channel to preserve per-inbox log namespaces.
 */
export function createInbox<T>(
  channel: string,
): (cb: (p: T) => void, deps?: { listen?: InboxListen }) => () => void {
  const log = createLogger(channel);
  return (cb, deps) => {
    let unlistenFn: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      let listen: InboxListen | undefined;
      let options: Options | undefined;
      try {
        listen = deps?.listen ?? (await resolveTauriListen());
        if (listen && isTauri()) {
          const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
          options = { target: { kind: "WebviewWindow", label: getCurrentWebviewWindow().label } };
        }
      } catch (err) {
        log.warn("listen_resolve_failed", { degrade: true, error: String(err) });
        return;
      }
      if (!listen) {
        log.debug("listen_unavailable", { degrade: true });
        return;
      }
      if (cancelled) return;
      try {
        const handler: Parameters<InboxListen>[1] = ({ payload }) => {
          if (!cancelled) cb(payload as unknown as T);
        };
        unlistenFn = options
          ? await listen(channel, handler, options)
          : await listen(channel, handler);
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
