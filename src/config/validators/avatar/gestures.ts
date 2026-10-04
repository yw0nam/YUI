import type { GestureCuesConfig } from "../../load";
import { isObject } from "../shared";
import { cue, rejectUnknownKeys, type SectionContext } from "./helpers";

/** Gesture cues, in the order their issues are reported. */
const GESTURE_CUE_KEYS = ["drag_held", "window_sit", "peek", "dropped"] as const;

// drag_hold_ms — how long a drag is held before the reflex cue fires.
export function validateDragHoldMs(
  raw: Record<string, unknown>,
  ctx: SectionContext,
): number | undefined {
  const { issues } = ctx;
  const rawDragHoldMs = raw.drag_hold_ms;
  let drag_hold_ms: number | undefined;
  if (typeof rawDragHoldMs !== "number" || !Number.isInteger(rawDragHoldMs) || rawDragHoldMs < 1) {
    issues.push(`drag_hold_ms must be an integer >= 1 (got: ${JSON.stringify(rawDragHoldMs)})`);
  } else {
    drag_hold_ms = rawDragHoldMs;
  }
  return drag_hold_ms;
}

// gesture_cues — reflex-gesture speech cues.
export function validateGestureCues(
  raw: Record<string, unknown>,
  ctx: SectionContext,
): Partial<GestureCuesConfig> {
  const { issues } = ctx;
  const gesture_cues: Partial<GestureCuesConfig> = {};
  const rawGestureCues = raw.gesture_cues;
  if (!isObject(rawGestureCues)) {
    issues.push(`gesture_cues must be an object (got: ${JSON.stringify(rawGestureCues)})`);
  } else {
    rejectUnknownKeys(issues, rawGestureCues, GESTURE_CUE_KEYS, "gesture_cues");
    for (const key of GESTURE_CUE_KEYS) {
      const entry = rawGestureCues[key];
      if (!isObject(entry)) {
        issues.push(`gesture_cues.${key} must be an object (got: ${JSON.stringify(entry)})`);
        continue;
      }
      gesture_cues[key] = cue(issues, entry, `gesture_cues.${key}`);
    }
  }
  return gesture_cues;
}
