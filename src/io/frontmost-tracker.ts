/**
 * Latest frontmost-window sample off the `os_event` channel.
 *
 * Keeps the newest app/title pair plus the tick timestamp of the last change —
 * unchanged polls do not move `since`. A tick without frontmost fields clears
 * the sample (no foreign window in the foreground, or unsupported platform).
 */

import type { FrontmostState } from "../contract";
import type { OsEventPayload } from "./tauri-listen";

export interface FrontmostTracker {
  onTick: (payload: OsEventPayload) => void;
  get: () => FrontmostState | undefined;
}

export function createFrontmostTracker(): FrontmostTracker {
  let state: FrontmostState | undefined;
  return {
    onTick(payload) {
      const app = payload.data.frontmost_app ?? undefined;
      const windowTitle = payload.data.frontmost_title ?? undefined;
      if (app === undefined && windowTitle === undefined) {
        state = undefined;
        return;
      }
      if (state && state.app === app && state.window_title === windowTitle) return;
      state = {
        ...(app !== undefined ? { app } : {}),
        ...(windowTitle !== undefined ? { window_title: windowTitle } : {}),
        since: payload.ts,
      };
    },
    get: () => state,
  };
}
