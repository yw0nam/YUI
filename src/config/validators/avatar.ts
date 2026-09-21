import type {
  AvatarConfig,
  AvatarOption,
  ClimbConfig,
  DescendConfig,
  FallConfig,
  FramingConfig,
  GazeKnobs,
  GestureCueConfig,
  GestureCuesConfig,
  HitTestKnobs,
  JumpConfig,
  PeekConfig,
  PerchWalkConfig,
  TapConfig,
  WalkConfig,
} from "../load";
import { assertValid, ConfigError, isObject } from "./shared";

const AVATAR_SOURCES: readonly NonNullable<AvatarOption["source"]>[] = ["bundled", "file", "user"];
/** Allowed chars for AvatarOption.id — a persistence key and the CSS selector `[data-vrm-id="…"]` value, so no whitespace/special chars. */
const AVATAR_ID_RE = /^[A-Za-z0-9._-]+$/;

/** Tap regions and gesture cues, in the order their issues are reported. */
const TAP_REGIONS = ["head", "chest", "hips"] as const;
const GESTURE_CUE_KEYS = ["drag_held", "window_sit", "peek", "dropped"] as const;

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

  /** obj[key] when it is a finite number `ok` accepts; records `path.key` and returns undefined otherwise. */
  const num = (
    obj: Record<string, unknown>,
    path: string,
    key: string,
    ok: (v: number) => boolean,
    expected: string,
  ): number | undefined => {
    const value = obj[key];
    if (typeof value !== "number" || !Number.isFinite(value) || !ok(value)) {
      issues.push(`${path}.${key} must be ${expected} (got: ${JSON.stringify(value)})`);
      return undefined;
    }
    return value;
  };

  /** Same for an integer. */
  const int = (
    obj: Record<string, unknown>,
    path: string,
    key: string,
    ok: (v: number) => boolean,
    expected: string,
  ): number | undefined => {
    const value = obj[key];
    if (typeof value !== "number" || !Number.isInteger(value) || !ok(value)) {
      issues.push(`${path}.${key} must be ${expected} (got: ${JSON.stringify(value)})`);
      return undefined;
    }
    return value;
  };

  /** obj[key] when it is a non-empty string; records `path.key` and returns undefined otherwise. */
  const str = (obj: Record<string, unknown>, path: string, key: string): string | undefined => {
    const value = obj[key];
    if (typeof value !== "string" || value.length === 0) {
      issues.push(`${path}.${key} must be a non-empty string (got: ${JSON.stringify(value)})`);
      return undefined;
    }
    return value;
  };

  /** Records an issue when both bounds are present and the minimum exceeds the maximum. */
  const requireOrder = (
    path: string,
    minKey: string,
    min: number | undefined,
    maxKey: string,
    max: number | undefined,
  ): void => {
    if (min === undefined || max === undefined || min <= max) return;
    issues.push(`${path}.${minKey} must be <= ${path}.${maxKey} (got: ${min} > ${max})`);
  };

  /** One `{ label, context? }` cue. label is required; context stays optional user intent. */
  const cue = (obj: Record<string, unknown>, path: string): GestureCueConfig | undefined => {
    const label = str(obj, path, "label");
    const context = obj.context;
    if (context !== undefined && (typeof context !== "string" || context.length === 0)) {
      issues.push(`${path}.context must be a non-empty string (got: ${JSON.stringify(context)})`);
      return undefined;
    }
    if (label === undefined) return undefined;
    return { label, ...(context !== undefined ? { context: context as string } : {}) };
  };

  const positive = (v: number): boolean => v > 0;
  const nonNegative = (v: number): boolean => v >= 0;
  const unit = (v: number): boolean => v >= 0 && v <= 1;

  // available[] — optional VRM swap manifest.
  let available: AvatarOption[] | undefined;
  const rawAvailable = raw.available;
  if (rawAvailable !== undefined) {
    if (!Array.isArray(rawAvailable)) {
      throw new ConfigError(file, [
        `available must be an array (got: ${JSON.stringify(rawAvailable)})`,
      ]);
    }
    available = [];
    rawAvailable.forEach((entry, i) => {
      if (!isObject(entry)) {
        issues.push(`available[${i}]: entry is not an object`);
        return;
      }
      for (const k of ["id", "label", "url"] as const) {
        if (typeof entry[k] !== "string" || (entry[k] as string).length === 0) {
          issues.push(
            `available[${i}].${k} must be a non-empty string (got: ${JSON.stringify(entry[k])})`,
          );
        }
      }
      // id is a persistence key + CSS selector value — no whitespace/quotes or other special chars ([A-Za-z0-9._-]).
      if (typeof entry.id === "string" && !AVATAR_ID_RE.test(entry.id)) {
        issues.push(
          `available[${i}].id must contain only [A-Za-z0-9._-] (got: ${JSON.stringify(entry.id)})`,
        );
      }
      const source = entry.source;
      if (
        source !== undefined &&
        !AVATAR_SOURCES.includes(source as AvatarOption["source"] & string)
      ) {
        issues.push(
          `available[${i}].source must be one of ${AVATAR_SOURCES.join("|")} (got: ${JSON.stringify(source)})`,
        );
      }
      available!.push({
        id: entry.id as string,
        label: entry.label as string,
        url: entry.url as string,
        ...(source !== undefined ? { source: source as AvatarOption["source"] } : {}),
      });
    });
    // id uniqueness — find(x => x.id === …) resolves to the first entry only, so a duplicate is permanently unreachable.
    const seen = new Set<string>();
    available.forEach((opt, i) => {
      if (seen.has(opt.id)) {
        issues.push(`available[${i}].id is a duplicate (got: ${JSON.stringify(opt.id)})`);
      }
      seen.add(opt.id);
    });
  }

  // framing — fit-to-bounds camera.
  const framing: Partial<FramingConfig> = {};
  const rawFraming = raw.framing;
  if (!isObject(rawFraming)) {
    issues.push(`framing must be an object (got: ${JSON.stringify(rawFraming)})`);
  } else {
    framing.margin = num(rawFraming, "framing", "margin", nonNegative, "a finite number >= 0");
    framing.fov = num(
      rawFraming,
      "framing",
      "fov",
      (v) => v > 0 && v < 180,
      "a finite number in (0, 180)",
    );
  }

  // hit_test — click-through polling and the silhouette alpha cut.
  const hit_test: Partial<HitTestKnobs> = {};
  const rawHitTest = raw.hit_test;
  if (!isObject(rawHitTest)) {
    issues.push(`hit_test must be an object (got: ${JSON.stringify(rawHitTest)})`);
  } else {
    hit_test.hysteresis_margin_px = num(
      rawHitTest,
      "hit_test",
      "hysteresis_margin_px",
      nonNegative,
      "a finite number >= 0",
    );
    hit_test.poll_interval_ms = num(
      rawHitTest,
      "hit_test",
      "poll_interval_ms",
      positive,
      "a finite number > 0",
    );
    hit_test.debounce_samples = int(
      rawHitTest,
      "hit_test",
      "debounce_samples",
      (v) => v >= 1,
      "an integer >= 1",
    );
    hit_test.alpha_threshold = num(
      rawHitTest,
      "hit_test",
      "alpha_threshold",
      (v) => v > 0 && v <= 1,
      "a finite number in (0, 1]",
    );
  }

  // tap — region reactions and the touch speech candidates.
  const tap: Partial<TapConfig> = {};
  const rawTap = raw.tap;
  if (!isObject(rawTap)) {
    issues.push(`tap must be an object (got: ${JSON.stringify(rawTap)})`);
  } else {
    tap.spam_count = int(rawTap, "tap", "spam_count", (v) => v >= 2, "an integer >= 2");
    tap.spam_window_ms = int(
      rawTap,
      "tap",
      "spam_window_ms",
      (v) => v >= 1 && v <= 60_000,
      "an integer in [1, 60000]",
    );
    tap.region_radius_frac = num(
      rawTap,
      "tap",
      "region_radius_frac",
      (v) => v > 0 && v <= 1,
      "a finite number in (0, 1]",
    );
    tap.touch_cue_cooldown_ms = int(
      rawTap,
      "tap",
      "touch_cue_cooldown_ms",
      nonNegative,
      "an integer >= 0",
    );
    tap.touch_emotion_hold_ms = int(
      rawTap,
      "tap",
      "touch_emotion_hold_ms",
      (v) => v >= 1,
      "an integer >= 1",
    );
    tap.pat_hold_ms = int(rawTap, "tap", "pat_hold_ms", (v) => v >= 1, "an integer >= 1");

    const rawRegionMotions = rawTap.region_motions;
    if (!isObject(rawRegionMotions)) {
      issues.push(
        `tap.region_motions must be an object (got: ${JSON.stringify(rawRegionMotions)})`,
      );
    } else {
      rejectUnknownKeys(issues, rawRegionMotions, TAP_REGIONS, "tap.region_motions");
      const motions: Partial<TapConfig["region_motions"]> = {};
      for (const region of TAP_REGIONS) {
        motions[region] = str(rawRegionMotions, "tap.region_motions", region);
      }
      tap.region_motions = motions as TapConfig["region_motions"];
    }

    const rawBoredCue = rawTap.bored_cue;
    if (!isObject(rawBoredCue)) {
      issues.push(`tap.bored_cue must be an object (got: ${JSON.stringify(rawBoredCue)})`);
    } else {
      tap.bored_cue = cue(rawBoredCue, "tap.bored_cue");
    }

    // region_emotions — optional; a region left out keeps the motion alone.
    const rawRegionEmotions = rawTap.region_emotions;
    if (rawRegionEmotions !== undefined) {
      if (!isObject(rawRegionEmotions)) {
        issues.push(
          `tap.region_emotions must be an object (got: ${JSON.stringify(rawRegionEmotions)})`,
        );
      } else {
        rejectUnknownKeys(issues, rawRegionEmotions, TAP_REGIONS, "tap.region_emotions");
        const emotions: NonNullable<TapConfig["region_emotions"]> = {};
        for (const region of TAP_REGIONS) {
          if (rawRegionEmotions[region] === undefined) continue;
          emotions[region] = str(rawRegionEmotions, "tap.region_emotions", region);
        }
        tap.region_emotions = emotions;
      }
    }

    // region_cues — optional; a region left out offers no touch speech candidate.
    const rawRegionCues = rawTap.region_cues;
    if (rawRegionCues !== undefined) {
      if (!isObject(rawRegionCues)) {
        issues.push(`tap.region_cues must be an object (got: ${JSON.stringify(rawRegionCues)})`);
      } else {
        rejectUnknownKeys(issues, rawRegionCues, TAP_REGIONS, "tap.region_cues");
        const cues: NonNullable<TapConfig["region_cues"]> = {};
        for (const region of TAP_REGIONS) {
          const entry = rawRegionCues[region];
          if (entry === undefined) continue;
          if (!isObject(entry)) {
            issues.push(
              `tap.region_cues.${region} must be an object (got: ${JSON.stringify(entry)})`,
            );
            continue;
          }
          cues[region] = cue(entry, `tap.region_cues.${region}`);
        }
        tap.region_cues = cues;
      }
    }
  }

  // peek — side-peek geometry and mirroring.
  const peek: Partial<PeekConfig> = {};
  const rawPeek = raw.peek;
  if (!isObject(rawPeek)) {
    issues.push(`peek must be an object (got: ${JSON.stringify(rawPeek)})`);
  } else {
    for (const field of ["side_out_frac", "side_in_frac"] as const) {
      peek[field] = num(
        rawPeek,
        "peek",
        field,
        (v) => v > 0 && v <= 2,
        "a finite number in (0, 2]",
      );
    }
    peek.inset_frac = num(rawPeek, "peek", "inset_frac", unit, "a finite number in [0, 1]");
    const mirrorSide = rawPeek.mirror_side;
    if (mirrorSide !== "left" && mirrorSide !== "right" && mirrorSide !== "none") {
      issues.push(
        `peek.mirror_side must be one of left|right|none (got: ${JSON.stringify(mirrorSide)})`,
      );
    } else {
      peek.mirror_side = mirrorSide;
    }
  }

  // walk — ambient floor stroll.
  const walk: Partial<WalkConfig> = {};
  const rawWalk = raw.walk;
  if (!isObject(rawWalk)) {
    issues.push(`walk must be an object (got: ${JSON.stringify(rawWalk)})`);
  } else {
    for (const field of [
      "interval_min_ms",
      "interval_max_ms",
      "distance_min_px",
      "distance_max_px",
    ] as const) {
      walk[field] = num(rawWalk, "walk", field, positive, "a finite number > 0");
    }
    walk.floor_tolerance_px = num(
      rawWalk,
      "walk",
      "floor_tolerance_px",
      nonNegative,
      "a finite number >= 0",
    );
    requireOrder(
      "walk",
      "interval_min_ms",
      walk.interval_min_ms,
      "interval_max_ms",
      walk.interval_max_ms,
    );
    requireOrder(
      "walk",
      "distance_min_px",
      walk.distance_min_px,
      "distance_max_px",
      walk.distance_max_px,
    );
  }

  // perch_walk — ambient stroll along a window top.
  const perch_walk: Partial<PerchWalkConfig> = {};
  const rawPerchWalk = raw.perch_walk;
  if (!isObject(rawPerchWalk)) {
    issues.push(`perch_walk must be an object (got: ${JSON.stringify(rawPerchWalk)})`);
  } else {
    for (const field of ["dwell_min_ms", "dwell_max_ms"] as const) {
      perch_walk[field] = int(rawPerchWalk, "perch_walk", field, nonNegative, "an integer >= 0");
    }
    for (const field of ["distance_min_px", "distance_max_px"] as const) {
      perch_walk[field] = num(rawPerchWalk, "perch_walk", field, positive, "a finite number > 0");
    }
    perch_walk.edge_margin_frac = num(
      rawPerchWalk,
      "perch_walk",
      "edge_margin_frac",
      unit,
      "a finite number in [0, 1]",
    );
    perch_walk.level_tolerance_px = num(
      rawPerchWalk,
      "perch_walk",
      "level_tolerance_px",
      nonNegative,
      "a finite number >= 0",
    );
    requireOrder(
      "perch_walk",
      "dwell_min_ms",
      perch_walk.dwell_min_ms,
      "dwell_max_ms",
      perch_walk.dwell_max_ms,
    );
    requireOrder(
      "perch_walk",
      "distance_min_px",
      perch_walk.distance_min_px,
      "distance_max_px",
      perch_walk.distance_max_px,
    );
  }

  // fall — drag-release dynamics and the surfaces a fall stops on.
  const fall: Partial<FallConfig> = {};
  const rawFall = raw.fall;
  if (!isObject(rawFall)) {
    issues.push(`fall must be an object (got: ${JSON.stringify(rawFall)})`);
  } else {
    for (const field of ["gravity_px_s2", "max_speed_px_s", "land_room_frac"] as const) {
      fall[field] = num(rawFall, "fall", field, positive, "a finite number > 0");
    }
    fall.min_drop_frac = num(rawFall, "fall", "min_drop_frac", unit, "a finite number in [0, 1]");
    fall.cue_cooldown_ms = int(rawFall, "fall", "cue_cooldown_ms", nonNegative, "an integer >= 0");
    fall.step_off_probability = num(
      rawFall,
      "fall",
      "step_off_probability",
      unit,
      "a finite number in [0, 1]",
    );
  }

  // descend — upper-to-lower monitor descent choices.
  const descend: Partial<DescendConfig> = {};
  const rawDescend = raw.descend;
  if (!isObject(rawDescend)) {
    issues.push(`descend must be an object (got: ${JSON.stringify(rawDescend)})`);
  } else {
    for (const field of ["chance", "climb_down_chance"] as const) {
      descend[field] = num(rawDescend, "descend", field, unit, "a finite number in [0, 1]");
    }
  }

  // climb — ambient window climb.
  const climb: Partial<ClimbConfig> = {};
  const rawClimb = raw.climb;
  if (!isObject(rawClimb)) {
    issues.push(`climb must be an object (got: ${JSON.stringify(rawClimb)})`);
  } else {
    for (const field of [
      "interval_min_ms",
      "interval_max_ms",
      "perch_dwell_min_ms",
      "perch_dwell_max_ms",
    ] as const) {
      climb[field] = int(rawClimb, "climb", field, nonNegative, "an integer >= 0");
    }
    for (const field of [
      "max_height_frac",
      "hang_frac",
      "wall_offset_frac",
      "descent_wall_offset_frac",
      "ledge_walk_min_frac",
      "ledge_walk_max_frac",
    ] as const) {
      climb[field] = num(rawClimb, "climb", field, positive, "a finite number > 0");
    }
    requireOrder(
      "climb",
      "interval_min_ms",
      climb.interval_min_ms,
      "interval_max_ms",
      climb.interval_max_ms,
    );
    requireOrder(
      "climb",
      "perch_dwell_min_ms",
      climb.perch_dwell_min_ms,
      "perch_dwell_max_ms",
      climb.perch_dwell_max_ms,
    );
    requireOrder(
      "climb",
      "ledge_walk_min_frac",
      climb.ledge_walk_min_frac,
      "ledge_walk_max_frac",
      climb.ledge_walk_max_frac,
    );
  }

  // jump — window-to-window flight.
  const jump: Partial<JumpConfig> = {};
  const rawJump = raw.jump;
  if (!isObject(rawJump)) {
    issues.push(`jump must be an object (got: ${JSON.stringify(rawJump)})`);
  } else {
    for (const field of ["probability", "takeoff_frac", "land_frac"] as const) {
      jump[field] = num(rawJump, "jump", field, unit, "a finite number in [0, 1]");
    }
    for (const field of [
      "height_up_max_frac",
      "height_down_max_frac",
      "gap_max_width_frac",
      "apex_lift_frac",
    ] as const) {
      jump[field] = num(rawJump, "jump", field, positive, "a finite number > 0");
    }
    jump.flight_timeout_ms = int(rawJump, "jump", "flight_timeout_ms", positive, "an integer > 0");
    if (
      jump.takeoff_frac !== undefined &&
      jump.land_frac !== undefined &&
      jump.takeoff_frac >= jump.land_frac
    ) {
      issues.push(
        `jump.takeoff_frac must be < jump.land_frac (got: ${jump.takeoff_frac} >= ${jump.land_frac})`,
      );
    }
  }

  // drag_hold_ms — how long a drag is held before the reflex cue fires.
  const rawDragHoldMs = raw.drag_hold_ms;
  let drag_hold_ms: number | undefined;
  if (typeof rawDragHoldMs !== "number" || !Number.isInteger(rawDragHoldMs) || rawDragHoldMs < 1) {
    issues.push(`drag_hold_ms must be an integer >= 1 (got: ${JSON.stringify(rawDragHoldMs)})`);
  } else {
    drag_hold_ms = rawDragHoldMs;
  }

  // gesture_cues — reflex-gesture speech cues.
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
      gesture_cues[key] = cue(entry, `gesture_cues.${key}`);
    }
  }

  // gaze — cursor tracking angles and damping.
  const gaze: Partial<GazeKnobs> = {};
  const rawGaze = raw.gaze;
  if (!isObject(rawGaze)) {
    issues.push(`gaze must be an object (got: ${JSON.stringify(rawGaze)})`);
  } else {
    /** Only deadDeg and headNeckSplit accept their lower bound; the other angles are above it. */
    const ranged = (
      key: keyof GazeKnobs,
      min: number,
      max: number,
      minInclusive: boolean,
    ): void => {
      gaze[key] = num(
        rawGaze,
        "gaze",
        key,
        (v) => (minInclusive ? v >= min : v > min) && v <= max,
        `a finite number in ${minInclusive ? "[" : "("}${min}, ${max}]`,
      );
    };
    ranged("deadDeg", 0, 180, true);
    ranged("headEngageDeg", 0, 180, false);
    ranged("disengageDeg", 0, 180, false);
    // Zero degrees per mount width would freeze tracking, which the gaze on/off toggle owns;
    // the ceiling matches the other degree-valued keys.
    ranged("sensitivity", 0, 180, false);
    ranged("maxHeadYaw", 0, 90, false);
    ranged("maxHeadPitch", 0, 90, false);
    ranged("eyeMaxDeg", 0, 90, false);
    ranged("headNeckSplit", 0, 1, true);
    ranged("smooth", 0, 1000, false);
  }

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

/** Records an issue for every key of `obj` outside `allowed`. */
function rejectUnknownKeys(
  issues: string[],
  obj: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) issues.push(`${path}.${key} is an unknown key`);
  }
}
