/** Pure tier-1 control directive for sit, drop, peek and pat events. */
import type { ControlEnvelope, EmotionId, Posture } from "../../contract";
import { PERCH_MOTION_ID } from "../../io/window/geometry/perch";
import type { Logger } from "../../logger";
import type { BusEnvelope } from "./event-bus";

/** A sit that pins the perch target: the drag drop and the ambient climb's ledge sit. */
export function isSitDrop(eventName: string): boolean {
  return eventName === "user.window_sit_drop" || eventName === "avatar.window_sit";
}

export function samePosture(a: Posture, b: Posture): boolean {
  return (
    a.state === b.state &&
    a.perched_on?.app === b.perched_on?.app &&
    a.perched_on?.window_title === b.perched_on?.window_title
  );
}

/**
 * tier1 event → render directive mapping (local, backend-independent).
 *  - drag_start → play motion "drag" / drag_end → return to idle (motion null).
 *  - user.tap → observability only; tap_region / pat_start → payload motion.
 *  - pat_end → return to idle (motion null).
 *  - avatar.walk_* → no render; the ambient walker owns the walk clip and only the posture moves.
 *  - avatar.climb_* → no render; the climber owns the climb clips and only the posture moves.
 *  - avatar.window_sit → the sit the climber reached on its own, rendered like a drop.
 *  - user.fall_land → no render; the faller owns the falling/landing clips and the posture is unchanged.
 *  - avatar.jump → no render; the jumper owns the jump clip and the posture stays walking.
 * Returning null means no render.
 */
export function tier1Directive(env: BusEnvelope, log: Logger): ControlEnvelope | null {
  switch (env.event_name) {
    case "user.drag_start":
      return { speech_text: "", motion: { id: "drag" } };
    case "user.drag_end":
      return { speech_text: "", motion: null };
    case "user.window_sit_enter":
      return { speech_text: "", motion: { id: PERCH_MOTION_ID } };
    case "user.window_sit_drop":
    case "avatar.window_sit":
      return { speech_text: "", motion: { id: PERCH_MOTION_ID } };
    case "user.window_sit_exit":
      return { speech_text: "", motion: null };
    case "user.peek_drop":
      return { speech_text: "", motion: { id: "peek" } };
    case "user.peek_exit":
      return { speech_text: "", motion: null };
    case "user.tap":
    case "user.fall_land":
    case "avatar.jump":
    case "avatar.climb_start":
    case "avatar.climb_end":
      return null;
    case "user.pat_end":
      return { speech_text: "", motion: null };
    case "user.tap_region":
    case "user.pat_start": {
      const motionId = env.payload?.motion_id;
      if (typeof motionId !== "string" || motionId.length === 0) {
        log.warn("tap_motion.malformed", { seq_id: env.seq_id, payload: env.payload });
        return null;
      }
      // emotion is enrichment, motion is primary — a malformed emotion_id degrades to motion-only.
      const emotionId = env.payload?.emotion_id;
      return {
        speech_text: "",
        motion: { id: motionId },
        ...(typeof emotionId === "string" && emotionId.length > 0
          ? { emotion: { id: emotionId as EmotionId } }
          : {}),
      };
    }
    default:
      return null;
  }
}

export interface PeekDropPayload {
  side: "left" | "right";
  targetLocalXpx: number;
}

export function parsePeekDropPayload(env: BusEnvelope): PeekDropPayload | null {
  const side = env.payload?.side;
  const targetLocalXpx = env.payload?.target_local_xpx;
  if (
    (side !== "left" && side !== "right") ||
    typeof targetLocalXpx !== "number" ||
    !Number.isFinite(targetLocalXpx)
  ) {
    return null;
  }
  return { side, targetLocalXpx };
}
