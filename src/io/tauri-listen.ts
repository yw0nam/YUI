/**
 * Shared Tauri `os_event` IPC listen seam.
 *
 * The `os_event` channel payload shape plus a runtime-guarded resolver for the
 * real Tauri `listen`. Consumers (os-context, cowork idle source) share these so
 * the channel name and runtime guard live in one place.
 */

import { isTauri } from "./tauri-env";

/** `os_event` channel payload — mirrors src-tauri OsEventPayload (snake_case over IPC). */
export interface OsEventPayload {
  event_name: string;
  ts: number;
  data: {
    active_app_name?: string | null;
    active_window_title?: string | null;
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
