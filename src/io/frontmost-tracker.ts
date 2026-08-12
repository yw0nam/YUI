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

// Same order as the watcher's idle threshold: a clear longer than this is a real
// absence (desktop shown, screen lock), not a transient one, and must stamp fresh.
const RESTORE_GRACE_MS = 5 * 60_000;

export function createFrontmostTracker(): FrontmostTracker {
  let state: FrontmostState | undefined;
  // Survives a short clear (window switch churn; YUI/shell focus on Windows) so it
  // does not restart since; a clear past RESTORE_GRACE_MS is a real absence.
  let lastKnown: FrontmostState | undefined;
  let clearedAt: number | undefined;
  return {
    onTick(payload) {
      const app = payload.data.frontmost_app ?? undefined;
      const windowTitle = payload.data.frontmost_title ?? undefined;
      if (app === undefined && windowTitle === undefined) {
        // Stamp only on the transition into the clear — a sustained absence
        // repeats this tick every poll and must not keep pushing clearedAt out.
        if (state !== undefined) clearedAt = payload.ts;
        state = undefined;
        return;
      }
      if (state && state.app === app && state.window_title === windowTitle) return;
      if (
        !state &&
        lastKnown &&
        lastKnown.app === app &&
        lastKnown.window_title === windowTitle &&
        clearedAt !== undefined &&
        payload.ts - clearedAt <= RESTORE_GRACE_MS
      ) {
        state = lastKnown;
        return;
      }
      state = {
        ...(app !== undefined ? { app } : {}),
        ...(windowTitle !== undefined ? { window_title: windowTitle } : {}),
        since: payload.ts,
      };
      lastKnown = state;
    },
    get: () => state,
  };
}
