/**
 * Shared Tauri `os_event` IPC listen seam.
 *
 * The `os_event` channel payload shape plus a runtime-guarded resolver for the
 * real Tauri `listen`. Consumers (idle/proactive/schedule/agent/signals sources)
 * share these so the channel name and runtime guard live in one place.
 */

import { isTauri } from "./tauri-env";

/** `os_event` channel payload — mirrors src-tauri OsEventPayload (snake_case over IPC). */
export interface OsEventPayload {
  event_name: string;
  ts: number;
  data: {
    os_idle_ms?: number | null;
    is_fullscreen?: boolean | null;
  };
}

/** Tauri event `listen` signature (injectable for tests). */
export type OsEventListen = (
  event: string,
  handler: (e: { payload: OsEventPayload }) => void,
) => Promise<() => void>;

export const OS_EVENT_CHANNEL = "os_event";

/** Resolve the real Tauri `listen`, but only under the Tauri runtime. */
export async function resolveTauriListen(): Promise<OsEventListen | undefined> {
  if (!isTauri()) {
    return undefined;
  }
  const { listen } = await import("@tauri-apps/api/event");
  return listen as unknown as OsEventListen;
}

export async function subscribeOsEvent(params: {
  listen?: OsEventListen;
  onTick: (payload: OsEventPayload) => void;
  log: { debug: (msg: string, meta?: Record<string, unknown>) => void };
  subscribeTag?: string;
}): Promise<(() => void) | undefined> {
  const { listen: injected, onTick, log, subscribeTag = "subscribe_failed" } = params;
  let listen: OsEventListen | undefined;
  try {
    listen = injected ?? (await resolveTauriListen());
  } catch (err) {
    log.debug("listen_resolve_failed", { degrade: true, error: String(err) });
    return undefined;
  }
  if (!listen) return undefined;
  try {
    return await listen(OS_EVENT_CHANNEL, ({ payload }) => onTick(payload));
  } catch (err) {
    log.debug(subscribeTag, { degrade: true, error: String(err) });
    return undefined;
  }
}
