import { assertValid, ConfigError, isObject } from "../shared";
import { validateAvailable } from "./available";
import { validateClimb } from "./climb";
import { validateDescend, validateFall } from "./fall";
import { validateFraming } from "./framing";
import { validateGaze } from "./gaze";
import { validateDragHoldMs, validateGestureCues } from "./gestures";
import { validateHitTest } from "./hit-test";
import { validateJump } from "./jump";
import { validatePeek } from "./peek";
import { validateTap } from "./tap";
import type {
  AvatarConfig,
  AvatarOption,
  ClimbConfig,
  DescendConfig,
  FallConfig,
  FramingConfig,
  GazeKnobs,
  GestureCuesConfig,
  HitTestKnobs,
  JumpConfig,
  PeekConfig,
  PerchWalkConfig,
  TapConfig,
  WalkConfig,
} from "./types";
import { validatePerchWalk, validateWalk } from "./walk";

/**
 * configs/avatar.json → AvatarConfig. Every tunable section is required, and a key the file
 * omits fails validation naming that key. Section accumulators are partial while the keys are
 * read; assertValid throws before the return whenever one of them is still missing.
 */
export function validateAvatar(file: string, raw: unknown): AvatarConfig {
  if (!isObject(raw)) throw new ConfigError(file, ["not an object"]);
  const vrm_url = raw.vrm_url;
  if (typeof vrm_url !== "string" || vrm_url.length === 0) {
    throw new ConfigError(file, [
      `vrm_url must be a non-empty string (got: ${JSON.stringify(vrm_url)})`,
    ]);
  }
  const issues: string[] = [];
  const ctx = { issues };

  let available: AvatarOption[] | undefined;
  const rawAvailable = raw.available;
  if (rawAvailable !== undefined) {
    if (!Array.isArray(rawAvailable)) {
      throw new ConfigError(file, [
        `available must be an array (got: ${JSON.stringify(rawAvailable)})`,
      ]);
    }
    available = validateAvailable(rawAvailable, ctx);
  }
  const framing = validateFraming(raw, ctx);
  const hit_test = validateHitTest(raw, ctx);
  const tap = validateTap(raw, ctx);
  const peek = validatePeek(raw, ctx);
  const walk = validateWalk(raw, ctx);
  const perch_walk = validatePerchWalk(raw, ctx);
  const fall = validateFall(raw, ctx);
  const descend = validateDescend(raw, ctx);
  const climb = validateClimb(raw, ctx);
  const jump = validateJump(raw, ctx);
  const drag_hold_ms = validateDragHoldMs(raw, ctx);
  const gesture_cues = validateGestureCues(raw, ctx);
  const gaze = validateGaze(raw, ctx);

  assertValid(file, issues);
  return {
    vrm_url,
    framing: framing as FramingConfig,
    hit_test: hit_test as HitTestKnobs,
    tap: tap as TapConfig,
    peek: peek as PeekConfig,
    walk: walk as WalkConfig,
    perch_walk: perch_walk as PerchWalkConfig,
    fall: fall as FallConfig,
    descend: descend as DescendConfig,
    climb: climb as ClimbConfig,
    jump: jump as JumpConfig,
    drag_hold_ms: drag_hold_ms as number,
    gesture_cues: gesture_cues as GestureCuesConfig,
    gaze: gaze as GazeKnobs,
    ...(available !== undefined ? { available } : {}),
  };
}
